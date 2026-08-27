/**
 * The SaltBox demo renderer: ONE lightweight server that renders MANY
 * prospect demos from persisted Demo/DemoVersion state.
 *
 *   GET /d/<public-locator>  -> the demo's current persisted version
 *
 * Public-safety posture: opaque locator tokens only (no internal IDs in
 * URLs), no demo enumeration, noindex everywhere, a strict CSP with
 * form-action 'none' (the demo quote form can never submit anywhere), no
 * external requests, and no prospect HTML/scripts — templates render escaped
 * plain-text content exclusively.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Database } from "@saltbox/database/client";
import { resolveDemoByLocator } from "@saltbox/database/queries/demos";
import { esc } from "./html.ts";
import { asDemoContent, resolveTemplateRenderer } from "./templates/registry.ts";

const LOCATOR_PATH = /^\/d\/([A-Za-z0-9_-]{16,128})$/;

const BASE_HEADERS: Record<string, string> = {
  "x-robots-tag": "noindex, nofollow",
  "content-security-policy":
    "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "cache-control": "no-store",
};

export interface DemosAppOptions {
  db: Database;
  log?: (message: string, detail?: Record<string, unknown>) => void;
}

export function createDemosRequestHandler(options: DemosAppOptions) {
  const log = options.log ?? (() => {});
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const method = req.method ?? "GET";
    const path = (req.url ?? "/").split("?")[0] ?? "/";
    try {
      if (method !== "GET" && method !== "HEAD") {
        sendHtml(res, 405, statusPage("Method not allowed", "This renderer serves demo pages read-only."));
        return;
      }
      if (path === "/" || path === "") {
        sendHtml(
          res,
          200,
          statusPage(
            "SaltBox demo renderer",
            "This local server renders SaltBox demo previews. A demo is reachable only through its private locator link.",
          ),
        );
        return;
      }
      if (path === "/healthz") {
        res.writeHead(200, { ...BASE_HEADERS, "content-type": "text/plain; charset=utf-8" });
        res.end("ok");
        return;
      }
      const match = LOCATOR_PATH.exec(path);
      if (!match) {
        sendHtml(res, 404, statusPage("Not found", "There is no demo at this address."));
        return;
      }
      const token = match[1]!;
      const demo = await resolveDemoByLocator(options.db, token);
      if (!demo) {
        log("locator-miss", { path });
        sendHtml(res, 404, statusPage("Demo not found", "This demo link is unknown, revoked, or expired."));
        return;
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
        sendHtml(
          res,
          500,
          statusPage("Demo unavailable", "This demo version cannot be rendered by this renderer build."),
        );
        return;
      }
      log("demo-rendered", { demoId: demo.demoId, versionNumber: demo.version.versionNumber });
      sendHtml(res, 200, renderer(content));
    } catch (error) {
      log("render-error", { message: error instanceof Error ? error.message : String(error) });
      sendHtml(res, 503, statusPage("Renderer unavailable", "The local database is unavailable."));
    }
  };
}

export function createDemosServer(options: DemosAppOptions): Server {
  const handler = createDemosRequestHandler(options);
  return createServer((req, res) => {
    void handler(req, res);
  });
}

function sendHtml(res: ServerResponse, status: number, body: string): void {
  res.writeHead(status, { ...BASE_HEADERS, "content-type": "text/html; charset=utf-8" });
  res.end(body);
}

/** Minimal utility page (index/404/errors) — never enumerates demos. */
function statusPage(title: string, message: string): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow"><title>${esc(title)}</title>
<style>body{font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;background:#f5f6f8;color:#1c2430}
main{max-width:420px;padding:40px;text-align:center}h1{font-size:1.3rem;margin-bottom:10px}p{color:#5b6472}</style>
</head><body><main><h1>${esc(title)}</h1><p>${esc(message)}</p></main></body></html>`;
}
