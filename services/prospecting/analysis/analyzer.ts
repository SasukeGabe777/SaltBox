/**
 * Deterministic website analyzer (ADR-001 Level 0; ARCHITECTURE.md website-
 * analysis domain). One bounded HTTP fetch with manual redirect handling,
 * per-hop SSRF checks, timeouts, and a body-size cap.
 *
 * A broken website is an OBSERVATION, not a pipeline failure: every failure
 * mode returns a structured result instead of throwing (only programmer
 * errors propagate).
 */

import { createHash } from "node:crypto";
import { checkHostSafety, type LookupFn } from "./net-safety.ts";
import { extractHtmlSignals, type HtmlSignals } from "./html.ts";

export interface WebsiteAnalyzerOptions {
  /** Per-request timeout (default 8000 ms). */
  timeoutMs?: number;
  /** Maximum redirect hops before giving up (default 3). */
  maxRedirects?: number;
  /** Maximum HTML bytes read (default 512 KiB); larger bodies are rejected. */
  maxBodyBytes?: number;
  /**
   * Allow loopback/private destinations. ONLY for tests and the local
   * fixture runner, which host deterministic sites on 127.0.0.1.
   */
  allowPrivateNetworks?: boolean;
  fetchImpl?: typeof fetch;
  lookup?: LookupFn;
}

export type AnalyzerFailureStage =
  | "invalid_url"
  | "blocked_target"
  | "dns"
  | "tls"
  | "timeout"
  | "http"
  | "too_many_redirects"
  | "content_too_large"
  | "internal";

export interface WebsiteCheckResult {
  attempted: boolean;
  requestedUrl?: string;
  dnsResolved: boolean;
  reachable: boolean;
  finalUrl?: string;
  httpStatus?: number;
  https?: boolean;
  redirectChain: string[];
  latencyMs?: number;
  contentType?: string;
  htmlRetrieved: boolean;
  contentHash?: string;
  signals?: HtmlSignals;
  failure?: { stage: AnalyzerFailureStage; message: string };
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export async function analyzeWebsite(
  url: string | undefined,
  options: WebsiteAnalyzerOptions = {}
): Promise<WebsiteCheckResult> {
  const timeoutMs = options.timeoutMs ?? 8000;
  const maxRedirects = options.maxRedirects ?? 3;
  const maxBodyBytes = options.maxBodyBytes ?? 512 * 1024;
  const fetchImpl = options.fetchImpl ?? fetch;

  if (url === undefined || url.trim() === "") {
    return { attempted: false, dnsResolved: false, reachable: false, redirectChain: [], htmlRetrieved: false };
  }

  const base: WebsiteCheckResult = {
    attempted: true,
    requestedUrl: url,
    dnsResolved: false,
    reachable: false,
    redirectChain: [],
    htmlRetrieved: false,
  };

  let current: URL;
  try {
    current = new URL(url);
  } catch {
    return { ...base, failure: { stage: "invalid_url", message: `"${url}" is not a valid URL` } };
  }

  const started = performance.now();
  try {
    for (let hop = 0; hop <= maxRedirects; hop++) {
      if (current.protocol !== "http:" && current.protocol !== "https:") {
        return { ...base, failure: { stage: "blocked_target", message: `unsupported protocol ${current.protocol}` } };
      }

      if (!options.allowPrivateNetworks) {
        const safety = await checkHostSafety(current.hostname, options.lookup);
        if (!safety.ok) {
          if (safety.reason === "dns_failure") {
            return { ...base, failure: { stage: "dns", message: safety.detail } };
          }
          return { ...base, failure: { stage: "blocked_target", message: safety.detail } };
        }
      }
      base.dnsResolved = true;

      let response: Response;
      try {
        response = await fetchImpl(current.toString(), {
          redirect: "manual",
          signal: AbortSignal.timeout(timeoutMs),
          headers: { "user-agent": "SaltBoxAnalyzer/1.0 (deterministic website check)" },
        });
      } catch (error) {
        return { ...base, failure: classifyFetchFailure(error), latencyMs: elapsed(started) };
      }

      if (REDIRECT_STATUSES.has(response.status)) {
        const location = response.headers.get("location");
        await response.body?.cancel();
        if (!location) {
          return {
            ...base,
            reachable: true,
            httpStatus: response.status,
            latencyMs: elapsed(started),
            failure: { stage: "http", message: `redirect status ${response.status} without a Location header` },
          };
        }
        current = new URL(location, current);
        base.redirectChain.push(current.toString());
        continue;
      }

      const contentType = response.headers.get("content-type") ?? "";
      const result: WebsiteCheckResult = {
        ...base,
        reachable: true,
        finalUrl: current.toString(),
        httpStatus: response.status,
        https: current.protocol === "https:",
        latencyMs: elapsed(started),
        contentType,
      };

      if (!response.ok) {
        await response.body?.cancel();
        return { ...result, failure: { stage: "http", message: `HTTP ${response.status}` } };
      }
      if (!contentType.toLowerCase().includes("text/html")) {
        await response.body?.cancel();
        return result; // reachable, but no HTML to inspect
      }

      const body = await readBounded(response, maxBodyBytes);
      if (body === null) {
        return { ...result, failure: { stage: "content_too_large", message: `body exceeds ${maxBodyBytes} bytes` } };
      }

      const html = new TextDecoder().decode(body);
      return {
        ...result,
        htmlRetrieved: true,
        contentHash: createHash("sha256").update(body).digest("hex"),
        signals: extractHtmlSignals(html),
      };
    }
    return {
      ...base,
      latencyMs: elapsed(started),
      failure: { stage: "too_many_redirects", message: `more than ${maxRedirects} redirects` },
    };
  } catch (error) {
    // Defensive net: an unexpected bug must surface as a recorded failure,
    // not kill an entire discovery run.
    return {
      ...base,
      latencyMs: elapsed(started),
      failure: { stage: "internal", message: error instanceof Error ? error.message : String(error) },
    };
  }
}

function elapsed(started: number): number {
  return Math.round(performance.now() - started);
}

async function readBounded(response: Response, maxBytes: number): Promise<Uint8Array | null> {
  if (!response.body) return new Uint8Array(0);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged;
}

function classifyFetchFailure(error: unknown): { stage: AnalyzerFailureStage; message: string } {
  if (error instanceof Error) {
    if (error.name === "TimeoutError" || error.name === "AbortError") {
      return { stage: "timeout", message: "request timed out" };
    }
    const cause = (error as { cause?: { code?: string; message?: string } }).cause;
    const code = cause?.code ?? "";
    if (code === "ENOTFOUND" || code === "EAI_AGAIN") {
      return { stage: "dns", message: `DNS resolution failed (${code})` };
    }
    if (code.startsWith("ERR_TLS") || code.startsWith("UNABLE_TO") || code.includes("CERT")) {
      return { stage: "tls", message: `TLS failure (${code})` };
    }
    return { stage: "http", message: cause?.message ?? error.message };
  }
  return { stage: "http", message: String(error) };
}
