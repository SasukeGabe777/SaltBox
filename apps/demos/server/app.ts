/**
 * The SaltBox demo renderer, Node adapter.
 *
 * The request logic lives in the runtime-neutral handler (server/handler.ts);
 * this file only supplies Node-flavoured ports — a Kysely resolver and the
 * local artifact store — and speaks node:http.
 *
 *   GET /d/<public-locator>       -> a persisted demo version
 *   GET /demo-assets/<ref>/<file> -> a validated, locally stored brand asset
 *
 * Public-safety posture: opaque locator tokens only (no internal IDs in
 * URLs), no demo enumeration, noindex everywhere, a strict CSP with
 * form-action 'none' (the demo quote form can never submit anywhere), no
 * external requests, and no prospect HTML/scripts — templates render escaped
 * plain-text content exclusively.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { resolve } from "node:path";
import type { Database } from "@saltbox/database/client";
import { resolveDemoByLocator, type DemoResolutionMode } from "@saltbox/database/queries/demos";
import { findPublishedDemoAsset } from "@saltbox/database/repositories/demo-hosting";
import { loadDemoAsset } from "./assets.ts";
import { BASE_HEADERS, handleDemoRequest, type DemoHandlerPorts } from "./handler.ts";

export interface DemosAppOptions {
  db: Database;
  /** Root of the local demo-asset store; defaults to ../../.data/demo-assets. */
  assetRoot?: string;
  /**
   * `preview` (default) serves the demo's current version for local operator
   * review; `public` serves only the operator-approved version.
   */
  mode?: DemoResolutionMode;
  log?: (message: string, detail?: Record<string, unknown>) => void;
}

export function createDemosRequestHandler(options: DemosAppOptions) {
  const log = options.log ?? (() => {});
  const mode: DemoResolutionMode = options.mode ?? "preview";
  const assetRoot = options.assetRoot ?? resolve(process.cwd(), "../../.data/demo-assets");

  const ports: DemoHandlerPorts = {
    mode,
    log,
    resolveDemo: (token) => resolveDemoByLocator(options.db, token, { mode }),
    loadAsset: async (assetRef, fileName) => {
      // In public mode an asset must be a recorded, published asset of an
      // approved demo; the filesystem alone is never sufficient authority.
      if (mode === "public") {
        const published = await findPublishedDemoAsset(options.db, assetRef, fileName);
        if (!published) return undefined;
      }
      const asset = loadDemoAsset(assetRoot, assetRef, fileName);
      if (asset.status !== 200 || !asset.body || !asset.contentType) return undefined;
      return { contentType: asset.contentType, body: new Uint8Array(asset.body) };
    },
  };

  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    try {
      const response = await handleDemoRequest(
        { method: req.method ?? "GET", path: req.url ?? "/" },
        ports,
      );
      res.writeHead(response.status, response.headers);
      res.end(typeof response.body === "string" ? response.body : Buffer.from(response.body));
    } catch (error) {
      log("render-error", { message: error instanceof Error ? error.message : String(error) });
      res.writeHead(503, { ...BASE_HEADERS, "content-type": "text/html; charset=utf-8" });
      res.end(
        '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex, nofollow">' +
          "<title>Renderer unavailable</title></head><body><main><h1>Renderer unavailable</h1>" +
          "<p>The demo database is unavailable.</p></main></body></html>",
      );
    }
  };
}

export function createDemosServer(options: DemosAppOptions): Server {
  const handler = createDemosRequestHandler(options);
  return createServer((req, res) => {
    void handler(req, res);
  });
}
