/**
 * Network-safety baseline for the website analyzer.
 *
 * SaltBox will eventually fetch arbitrary URLs, so analysis requests must not
 * be able to reach loopback, private, link-local, or cloud-metadata
 * destinations. Hostnames are resolved BEFORE connecting and every resolved
 * address must be public.
 *
 * This is a reasonable baseline, not a full SSRF product. Known limitation:
 * the address check and the actual connection are separate resolutions, so a
 * DNS-rebinding attacker with sub-second TTLs could theoretically pass the
 * check and rebind. Acceptable for Phase 4's controlled inputs; a pinned-dial
 * transport can replace it when arbitrary discovery arrives.
 */

import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";

export type LookupFn = (hostname: string) => Promise<{ address: string; family: number }[]>;

export const BLOCKED_HOSTNAMES: ReadonlySet<string> = new Set([
  "localhost",
  "metadata.google.internal",
]);

export function isPrivateAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return isPrivateIpv4(address);
  if (family === 6) return isPrivateIpv6(address);
  // Not an IP literal at all — treat as unsafe; callers pass resolved IPs.
  return true;
}

function isPrivateIpv4(address: string): boolean {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p))) return true;
  const [a = 0, b = 0] = parts;
  if (a === 0 || a === 10 || a === 127) return true; // "this" net, private, loopback
  if (a === 169 && b === 254) return true; // link-local incl. cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a >= 224) return true; // multicast + reserved + broadcast
  return false;
}

function isPrivateIpv6(address: string): boolean {
  const lower = address.toLowerCase();
  const bare = lower.startsWith("[") ? lower.slice(1, -1) : lower;
  if (bare === "::1" || bare === "::") return true; // loopback / unspecified
  if (bare.startsWith("fc") || bare.startsWith("fd")) return true; // unique local fc00::/7
  if (bare.startsWith("fe8") || bare.startsWith("fe9") || bare.startsWith("fea") || bare.startsWith("feb")) {
    return true; // link-local fe80::/10
  }
  const mapped = bare.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/); // IPv4-mapped, dotted form
  if (mapped) return isPrivateIpv4(mapped[1]!);
  // IPv4-mapped in hex-group form (URL parsing normalizes ::ffff:10.0.0.1 to ::ffff:a00:1).
  const mappedHex = bare.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (mappedHex) {
    const high = Number.parseInt(mappedHex[1]!, 16);
    const low = Number.parseInt(mappedHex[2]!, 16);
    return isPrivateIpv4(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`);
  }
  return false;
}

export type HostSafetyResult =
  | { ok: true; addresses: string[] }
  | {
      ok: false;
      reason: "blocked_hostname" | "private_address" | "dns_failure";
      detail: string;
      dnsFailure?: DnsFailure;
    };

export type DnsFailure = {
  classification: "transient" | "not_found" | "other";
  code: string | null;
};

const defaultLookup: LookupFn = async (hostname) => dnsLookup(hostname, { all: true });

/**
 * Resolve a hostname and verify every resolved address is public.
 * IP-literal hosts are checked directly without DNS.
 */
export async function checkHostSafety(hostname: string, lookup: LookupFn = defaultLookup): Promise<HostSafetyResult> {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (BLOCKED_HOSTNAMES.has(normalized)) {
    return { ok: false, reason: "blocked_hostname", detail: `hostname "${normalized}" is blocked` };
  }
  if (isIP(normalized) !== 0) {
    return isPrivateAddress(normalized)
      ? { ok: false, reason: "private_address", detail: `address ${normalized} is private/reserved` }
      : { ok: true, addresses: [normalized] };
  }
  let results: { address: string }[];
  try {
    results = await lookup(normalized);
  } catch (error) {
    return {
      ok: false,
      reason: "dns_failure",
      detail: error instanceof Error ? error.message : String(error),
      dnsFailure: classifyDnsFailure(error),
    };
  }
  if (results.length === 0) {
    return {
      ok: false,
      reason: "dns_failure",
      detail: `no addresses resolved for ${normalized}`,
      dnsFailure: { classification: "not_found", code: "NO_ADDRESSES" },
    };
  }
  const privateHit = results.find((r) => isPrivateAddress(r.address));
  if (privateHit) {
    return {
      ok: false,
      reason: "private_address",
      detail: `${normalized} resolves to private/reserved address ${privateHit.address}`,
    };
  }
  return { ok: true, addresses: results.map((r) => r.address) };
}

export function classifyDnsFailure(error: unknown): DnsFailure {
  const code = errorCode(error);
  if (code && new Set(["EAI_AGAIN", "ETIMEOUT", "ESERVFAIL", "EREFUSED"]).has(code)) {
    return { classification: "transient", code };
  }
  if (code && new Set(["ENOTFOUND", "ENODATA", "ENONAME"]).has(code)) {
    return { classification: "not_found", code };
  }
  return { classification: "other", code };
}

function errorCode(error: unknown): string | null {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current && typeof current === "object"; depth += 1) {
    const candidate = current as { code?: unknown; cause?: unknown };
    if (typeof candidate.code === "string") return candidate.code.toUpperCase();
    current = candidate.cause;
  }
  return null;
}
