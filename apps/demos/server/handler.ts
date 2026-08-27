/**
 * The runtime-neutral demo request handler.
 *
 * ONE RENDERER, MANY DEMOS — and now one renderer across BOTH runtimes: the
 * local Node server and the hosted Cloudflare Worker call this same function
 * with different ports (database resolution and artifact loading). Nothing in
 * here imports Node or Cloudflare APIs.
 *
 * Resolution mode is the Phase 10 public-safety boundary:
 *   preview -> the demo's current version (local operator review)
 *   public  -> the operator-APPROVED version only; anything else is 404.
 */

import type { DemoResolutionMode, PublicDemoView } from "@saltbox/database/queries/demos";
import { esc } from "./html.ts";
import { asDemoContent, resolveTemplateRenderer } from "./templates/registry.ts";

export const LOCATOR_PATH = /^\/d\/([A-Za-z0-9_-]{16,128})$/;
export const ASSET_PATH = /^\/demo-assets\/([^/]{1,80})\/([^/]{1,60})$/;

export const BASE_HEADERS: Readonly<Record<string, string>> = {
  "x-robots-tag": "noindex, nofollow",
  // 'self' in img-src covers validated demo assets served by this origin only;
  // no other origin can ever be requested from a demo page.
  "content-security-policy":
    "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "cache-control": "no-store",
};

export interface LoadedDemoAsset {
  contentType: string;
  body: Uint8Array;
}

export interface DemoHandlerPorts {
  /** Which pointer this deployment serves. */
  mode: DemoResolutionMode;
  resolveDemo: (token: string) => Promise<PublicDemoView | undefined>;
  loadAsset: (assetRef: string, fileName: string) => Promise<LoadedDemoAsset | undefined>;
  log?: (message: string, detail?: Record<string, unknown>) => void;
}

export interface DemoHttpResponse {
  status: number;
  headers: Record<string, string>;
  body: string | Uint8Array;
}

export async function handleDemoRequest(
  request: { method: string; path: string },
  ports: DemoHandlerPorts,
): Promise<DemoHttpResponse> {
  const log = ports.log ?? (() => {});
  const method = request.method.toUpperCase();
  const path = request.path.split("?")[0] ?? "/";

  if (method !== "GET" && method !== "HEAD") {
    return html(405, statusPage("Method not allowed", "This renderer serves demo pages read-only."));
  }
  if (path === "/" || path === "") {
    // Never enumerates demos, in either environment.
    return html(
      200,
      statusPage(
        "SaltBox demo renderer",
        "This server renders SaltBox demo previews. A demo is reachable only through its private locator link.",
      ),
    );
  }
  if (path === "/healthz") {
    return { status: 200, headers: { ...BASE_HEADERS, "content-type": "text/plain; charset=utf-8" }, body: "ok" };
  }
  if (path === "/robots.txt") {
    return {
      status: 200,
      headers: { ...BASE_HEADERS, "content-type": "text/plain; charset=utf-8" },
      body: "User-agent: *\nDisallow: /\n",
    };
  }
  if (path === "/favicon.ico") {
    // Pages carry an inline data: favicon; this quiets legacy requests.
    return { status: 204, headers: { ...BASE_HEADERS }, body: "" };
  }

  const assetMatch = ASSET_PATH.exec(path);
  if (assetMatch) {
    const asset = await ports.loadAsset(assetMatch[1]!, assetMatch[2]!);
    if (!asset) return html(404, statusPage("Not found", "There is no asset at this address."));
    return {
      status: 200,
      headers: { ...BASE_HEADERS, "content-type": asset.contentType, "cache-control": "private, max-age=3600" },
      body: asset.body,
    };
  }

  const match = LOCATOR_PATH.exec(path);
  if (!match) return html(404, statusPage("Not found", "There is no demo at this address."));

  const demo = await ports.resolveDemo(match[1]!);
  if (!demo) {
    // Unknown, revoked, expired, and not-yet-approved are deliberately the
    // same response: a public visitor learns nothing about what exists.
    log("locator-miss", { mode: ports.mode });
    return html(404, statusPage("Demo not found", "This demo link is unknown, revoked, or expired."));
  }

  const content = asDemoContent(demo.version.content);
  const renderer = resolveTemplateRenderer(demo.version.templateName, demo.version.templateVersion);
  if (!content || !renderer) {
    log("unrenderable-version", {
      demoId: demo.demoId,
      templateName: demo.version.templateName,
      templateVersion: demo.version.templateVersion,
      hasContent: Boolean(content),
    });
    return html(500, statusPage("Demo unavailable", "This demo version cannot be rendered by this renderer build."));
  }

  log("demo-rendered", {
    demoId: demo.demoId,
    versionNumber: demo.version.versionNumber,
    mode: demo.resolvedFrom,
  });
  return html(200, renderer(content));
}

function html(status: number, body: string): DemoHttpResponse {
  return { status, headers: { ...BASE_HEADERS, "content-type": "text/html; charset=utf-8" }, body };
}

/** Minimal utility page (index/404/errors) — never enumerates demos. */
export function statusPage(title: string, message: string): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow"><title>${esc(title)}</title>
<style>body{font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;background:#f5f6f8;color:#1c2430}
main{max-width:420px;padding:40px;text-align:center}h1{font-size:1.3rem;margin-bottom:10px}p{color:#5b6472}</style>
</head><body><main><h1>${esc(title)}</h1><p>${esc(message)}</p></main></body></html>`;
}
