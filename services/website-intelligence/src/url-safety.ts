/**
 * Navigation-target safety for browser analysis. Reuses the Phase 4 SSRF
 * baseline (checkHostSafety): every navigation and link-check target is
 * DNS-resolved and must be public before any connection. The primary site
 * host is additionally IP-pinned into Chrome via --host-resolver-rules so a
 * DNS-rebinding site cannot re-point the main origin after validation.
 * Subresource fetches inside Chrome are additionally screened by request
 * interception for private IP literals and blocked hostnames (documented
 * residual: a public-DNS subresource host could still rebind mid-session).
 */

import { isIP } from "node:net";
import {
  BLOCKED_HOSTNAMES,
  checkHostSafety,
  classifyDnsFailure,
  isPrivateAddress,
  type LookupFn,
} from "@saltbox/prospecting/net-safety";
import { HTTP_FETCH_TIMEOUT_MS, INTELLIGENCE_HTTP_UA, MAX_REDIRECT_HOPS } from "./version.ts";

export interface UrlSafetyOptions {
  /** ONLY for tests/local fixtures on 127.0.0.1. */
  allowPrivateNetworks?: boolean;
  lookup?: LookupFn;
  fetchImpl?: typeof fetch;
}

export interface SafeTargetResult {
  ok: boolean;
  reason?: string;
  failureKind?: TargetFailureKind;
  failureCode?: string;
  transient?: boolean;
  /** Public addresses the hostname resolved to (for --host-resolver-rules pinning). */
  addresses?: string[];
}

export type TargetFailureKind =
  | "invalid_target"
  | "blocked_target"
  | "dns_transient"
  | "dns_not_found"
  | "dns_failure"
  | "tls_failure"
  | "timeout"
  | "unreachable";

/** Validate one URL as an allowed http(s) navigation target on a public host. */
export async function checkNavigationTarget(url: URL, options: UrlSafetyOptions = {}): Promise<SafeTargetResult> {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, reason: `unsupported protocol ${url.protocol}`, failureKind: "invalid_target" };
  }
  if (options.allowPrivateNetworks) return { ok: true, addresses: [] };
  const safety = await checkHostSafety(url.hostname, options.lookup);
  if (!safety.ok) {
    if (safety.reason === "dns_failure") {
      const classification = safety.dnsFailure?.classification ?? "other";
      return {
        ok: false,
        reason: safety.detail,
        failureKind:
          classification === "transient"
            ? "dns_transient"
            : classification === "not_found"
              ? "dns_not_found"
              : "dns_failure",
        ...(safety.dnsFailure?.code ? { failureCode: safety.dnsFailure.code } : {}),
        transient: classification === "transient",
      };
    }
    return { ok: false, reason: safety.detail, failureKind: "blocked_target", transient: false };
  }
  return { ok: true, addresses: safety.addresses };
}

/** Cheap synchronous screen used in request interception (no DNS). */
export function isObviouslyForbiddenHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (BLOCKED_HOSTNAMES.has(normalized)) return true;
  if (isIP(normalized) !== 0) return isPrivateAddress(normalized);
  return false;
}

export interface ResolvedHomepage {
  ok: boolean;
  reason?: string;
  failureKind?: TargetFailureKind;
  failureCode?: string;
  transient?: boolean;
  finalUrl?: URL;
  redirectChain: string[];
  httpStatus?: number;
  lastModified?: string | null;
  /** hostname → verified public addresses, for Chrome IP pinning. */
  pinnedHosts: Map<string, string[]>;
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/**
 * Resolve the homepage's redirect chain over plain HTTP with a per-hop SSRF
 * check, before any browser navigation. Returns the final URL plus every
 * validated hostname with its verified addresses.
 */
export async function resolveHomepage(url: string, options: UrlSafetyOptions = {}): Promise<ResolvedHomepage> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const pinnedHosts = new Map<string, string[]>();
  const redirectChain: string[] = [];
  let current: URL;
  try {
    current = new URL(url);
  } catch {
    return {
      ok: false,
      reason: `"${url}" is not a valid URL`,
      failureKind: "invalid_target",
      transient: false,
      redirectChain,
      pinnedHosts,
    };
  }

  for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop++) {
    const safety = await checkNavigationTarget(current, options);
    if (!safety.ok) {
      return {
        ok: false,
        reason: safety.reason ?? "blocked target",
        ...(safety.failureKind ? { failureKind: safety.failureKind } : {}),
        ...(safety.failureCode ? { failureCode: safety.failureCode } : {}),
        ...(safety.transient !== undefined ? { transient: safety.transient } : {}),
        redirectChain,
        pinnedHosts,
      };
    }
    if (safety.addresses && safety.addresses.length > 0) {
      pinnedHosts.set(current.hostname.toLowerCase(), safety.addresses);
    }

    let response: Response;
    try {
      response = await fetchImpl(current.toString(), {
        redirect: "manual",
        signal: AbortSignal.timeout(HTTP_FETCH_TIMEOUT_MS),
        headers: { "user-agent": INTELLIGENCE_HTTP_UA, accept: "text/html,*/*;q=0.8" },
      });
    } catch (error) {
      const failure = classifyRequestFailure(error);
      return {
        ok: false,
        reason: error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")
          ? "homepage request timed out"
          : `homepage request failed: ${error instanceof Error ? error.message : String(error)}`,
        failureKind: failure.kind,
        ...(failure.code ? { failureCode: failure.code } : {}),
        transient: failure.transient,
        redirectChain,
        pinnedHosts,
      };
    }

    if (REDIRECT_STATUSES.has(response.status)) {
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (!location) {
        return {
          ok: false,
          reason: `redirect ${response.status} without Location`,
          failureKind: "invalid_target",
          transient: false,
          redirectChain,
          pinnedHosts,
          httpStatus: response.status,
        };
      }
      try {
        current = new URL(location, current);
      } catch {
        return {
          ok: false,
          reason: `redirect ${response.status} contained an invalid Location`,
          failureKind: "invalid_target",
          transient: false,
          redirectChain,
          pinnedHosts,
          httpStatus: response.status,
        };
      }
      redirectChain.push(current.toString());
      continue;
    }

    const lastModified = response.headers.get("last-modified");
    await response.body?.cancel();
    return {
      ok: true,
      finalUrl: current,
      redirectChain,
      httpStatus: response.status,
      lastModified,
      pinnedHosts,
    };
  }
  return {
    ok: false,
    reason: `more than ${MAX_REDIRECT_HOPS} redirects`,
    failureKind: "unreachable",
    transient: false,
    redirectChain,
    pinnedHosts,
  };
}

function classifyRequestFailure(error: unknown): {
  kind: TargetFailureKind;
  code: string | null;
  transient: boolean;
} {
  if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
    return { kind: "timeout", code: error.name, transient: true };
  }
  const dns = classifyDnsFailure(error);
  if (dns.classification === "transient") return { kind: "dns_transient", code: dns.code, transient: true };
  if (dns.classification === "not_found") return { kind: "dns_not_found", code: dns.code, transient: false };
  const detail = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  if (/tls|ssl|certificate|cert_|_cert|unable_to_verify/i.test(`${dns.code ?? ""} ${detail}`)) {
    return { kind: "tls_failure", code: dns.code, transient: false };
  }
  return { kind: "unreachable", code: dns.code, transient: false };
}

/** True when two URLs belong to the same site (host equal, ignoring www.). */
export function isSameSite(a: URL, b: URL): boolean {
  const strip = (host: string) => host.toLowerCase().replace(/^www\./, "");
  return strip(a.hostname) === strip(b.hostname);
}
