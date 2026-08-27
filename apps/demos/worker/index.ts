/**
 * Hosted demo renderer (Cloudflare Worker).
 *
 * ONE RENDERER, MANY DEMOS: this entry point contains no templates and no
 * business rules. It builds the two ports the shared handler needs and hands
 * the request over.
 *
 *   Worker
 *     -> Kysely + pg  (ADR-006 runtime boundary)
 *     -> Hyperdrive connection string
 *     -> Neon PostgreSQL   (authoritative demo metadata)
 *     -> R2 bucket binding (durable demo assets)
 *
 * Public safety: this deployment always resolves in `public` mode, so only an
 * operator-APPROVED DemoVersion is ever served, and only assets recorded as
 * published for an approved demo are retrievable.
 */

import { createDatabase, type Database } from "@saltbox/database/client";
import { resolveDemoByLocator } from "@saltbox/database/queries/demos";
import { findPublishedDemoAsset } from "@saltbox/database/repositories/demo-hosting";
import { R2ArtifactStore, type R2BucketLike } from "@saltbox/artifact-store/r2";
import { demoAssetKey } from "@saltbox/artifact-store";
import { BASE_HEADERS, handleDemoRequest, statusPage } from "../server/handler.ts";

export interface DemoWorkerEnv {
  /** Hyperdrive binding (ADR-005: cache disabled for authoritative reads). */
  HYPERDRIVE?: { connectionString: string };
  /** Direct connection string; used when Hyperdrive is not bound. */
  DATABASE_URL?: string;
  /** Durable demo assets. */
  DEMO_ASSETS?: R2BucketLike;
}

export default {
  async fetch(request: Request, env: DemoWorkerEnv): Promise<Response> {
    const connectionString = env.HYPERDRIVE?.connectionString ?? env.DATABASE_URL;
    if (connectionString === undefined || connectionString === "") {
      return new Response(statusPage("Renderer unavailable", "This deployment has no database binding."), {
        status: 503,
        headers: { ...BASE_HEADERS, "content-type": "text/html; charset=utf-8" },
      });
    }

    // Request-scoped client: the Worker owns lifecycle, Hyperdrive owns the
    // pooled origin connections.
    const db: Database = createDatabase({ connectionString, maxConnections: 2 });
    const bucket = env.DEMO_ASSETS;
    const assets = bucket ? new R2ArtifactStore(bucket) : undefined;

    try {
      const url = new URL(request.url);
      const response = await handleDemoRequest(
        { method: request.method, path: url.pathname },
        {
          mode: "public",
          resolveDemo: (token) => resolveDemoByLocator(db, token, { mode: "public" }),
          loadAsset: async (assetRef, fileName) => {
            if (!assets) return undefined;
            // PostgreSQL is the authority on what is publicly retrievable.
            const published = await findPublishedDemoAsset(db, assetRef, fileName);
            if (!published) return undefined;
            const stored = await assets.get(demoAssetKey(assetRef, fileName));
            if (!stored) return undefined;
            return { contentType: published.contentType, body: stored.body };
          },
        },
      );
      const body = typeof response.body === "string" ? response.body : new Uint8Array(response.body);
      return new Response(response.status === 204 ? null : body, {
        status: response.status,
        headers: response.headers,
      });
    } catch {
      return new Response(statusPage("Renderer unavailable", "This demo cannot be served right now."), {
        status: 503,
        headers: { ...BASE_HEADERS, "content-type": "text/html; charset=utf-8" },
      });
    } finally {
      await db.destroy().catch(() => {});
    }
  },
};
