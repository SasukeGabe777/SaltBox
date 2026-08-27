/**
 * Phase 10 demo publication.
 *
 * Publication makes ONE approved DemoVersion available in an environment:
 * every image the version renders is copied into that environment's artifact
 * store, recorded in `demo_asset`, and the resulting durable URL is persisted.
 *
 * Publication never approves anything, never changes the locator, and never
 * touches an old DemoVersion. Only assets belonging to a published, approved
 * demo are reachable from a hosted asset route.
 */

import type { Database } from "@saltbox/database/client";
import {
  completeDemoPublication,
  failDemoPublication,
  startDemoPublication,
  upsertDemoAsset,
  type DemoPublicationEnvironment,
  type DemoPublicationRecord,
} from "@saltbox/database/repositories/demo-hosting";
import { appendEvent } from "@saltbox/database/repositories/events";
import { demoAssetKey, type ArtifactStore } from "@saltbox/artifact-store";
import { DEMO_ASSET_URL_PREFIX } from "./brand-view.ts";

export const DEMO_PUBLICATION_VERSION = "demo-publication-v1";

/** `/demo-assets/<run-ref>/<file>` — the only asset URL shape demos render. */
const ASSET_URL_PATTERN = new RegExp(`^${DEMO_ASSET_URL_PREFIX}/([0-9]{14}-[a-z0-9-]{1,60})/([a-z0-9-]{1,40}\\.(?:png|jpg|jpeg|webp))$`);

const CONTENT_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

export interface DemoAssetReference {
  assetRef: string;
  fileName: string;
  url: string;
}

/**
 * Collect every asset a persisted demo-content document renders. Anything that
 * is not a well-formed local demo-asset URL is ignored rather than fetched —
 * a demo never publishes an arbitrary remote resource.
 */
export function collectDemoAssetReferences(content: unknown): DemoAssetReference[] {
  const found = new Map<string, DemoAssetReference>();
  const visit = (value: unknown, depth: number): void => {
    if (depth > 6 || value === null || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1);
      return;
    }
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (key === "url" && typeof item === "string") {
        const match = ASSET_URL_PATTERN.exec(item);
        if (match) {
          const reference = { assetRef: match[1]!, fileName: match[2]!, url: item };
          found.set(item, reference);
        }
        continue;
      }
      visit(item, depth + 1);
    }
  };
  visit(content, 0);
  return [...found.values()].sort((a, b) => a.url.localeCompare(b.url));
}

export interface PublishDemoInput {
  demoId: string;
  environment: DemoPublicationEnvironment;
  /** Where the generated assets currently live (the local artifact store). */
  source: ArtifactStore;
  /** Where they must exist to be served in this environment. */
  destination: ArtifactStore;
  /** Public origin serving this environment, e.g. https://demos.example.workers.dev. */
  publicBaseUrl: string;
  actorRef: string;
  correlationId?: string;
  log?: (stage: string, detail?: Record<string, unknown>) => void;
}

export interface PublishDemoSummary {
  demoId: string;
  demoVersionId: string;
  versionNumber: number;
  environment: DemoPublicationEnvironment;
  publicUrl: string;
  publishedAssets: number;
  missingAssets: string[];
  publicationId: string;
}

export type PublishDemoResult =
  | { status: "published"; summary: PublishDemoSummary }
  | { status: "not_approved"; demoId: string }
  | { status: "not_found"; demoId: string }
  | { status: "failed"; demoId: string; message: string; publication?: DemoPublicationRecord };

export async function publishDemo(db: Database, input: PublishDemoInput): Promise<PublishDemoResult> {
  const log = input.log ?? (() => {});
  const baseUrl = input.publicBaseUrl.replace(/\/+$/, "");

  const demo = await db
    .selectFrom("demo")
    .innerJoin("prospect as p", "p.id", "demo.prospect_id")
    .select([
      "demo.id",
      "demo.status",
      "demo.approved_demo_version_id",
      "p.id as prospect_id",
      "p.business_id",
    ])
    .where("demo.id", "=", input.demoId)
    .executeTakeFirst();
  if (!demo || demo.status === "archived" || demo.status === "expired") {
    return { status: "not_found", demoId: input.demoId };
  }
  if (demo.approved_demo_version_id === null) {
    // Publication is only ever of an approved version: the public surface must
    // never expose something an operator has not reviewed.
    return { status: "not_approved", demoId: input.demoId };
  }

  const version = await db
    .selectFrom("demo_version")
    .select(["id", "version_number", "generator_metadata"])
    .where("id", "=", demo.approved_demo_version_id)
    .executeTakeFirstOrThrow();
  const locator = await db
    .selectFrom("demo_public_locator")
    .select("token")
    .where("demo_id", "=", demo.id)
    .where("status", "=", "active")
    .orderBy("created_at", "desc")
    .limit(1)
    .executeTakeFirst();
  if (!locator) {
    return { status: "failed", demoId: input.demoId, message: "The demo has no active public locator." };
  }

  const metadata = version.generator_metadata;
  const content =
    typeof metadata === "object" && metadata !== null && !Array.isArray(metadata)
      ? (metadata as Record<string, unknown>).content
      : undefined;
  const references = collectDemoAssetReferences(content);
  log("publication-started", {
    demoId: demo.id,
    versionNumber: version.version_number,
    assets: references.length,
    environment: input.environment,
  });

  const publication = await startDemoPublication(db, {
    demoId: demo.id,
    demoVersionId: version.id,
    environment: input.environment,
    actorType: "operator",
    actorRef: input.actorRef,
  });

  try {
    const publishedAt = new Date();
    const missingAssets: string[] = [];
    let publishedAssets = 0;
    for (const reference of references) {
      const key = demoAssetKey(reference.assetRef, reference.fileName);
      const stored = await input.source.get(key);
      if (!stored) {
        missingAssets.push(reference.url);
        log("asset-missing", { key });
        continue;
      }
      const contentType = CONTENT_TYPES[reference.fileName.split(".").pop() ?? ""] ?? stored.contentType;
      const written =
        input.destination.provider === input.source.provider && (await input.destination.has(key))
          ? { key, contentType, byteSize: stored.byteSize, contentHash: stored.contentHash }
          : await input.destination.put(key, stored.body, { contentType });
      await upsertDemoAsset(db, {
        demoId: demo.id,
        assetRef: reference.assetRef,
        fileName: reference.fileName,
        contentType: written.contentType,
        byteSize: written.byteSize,
        contentHash: written.contentHash,
        storageProvider: input.destination.provider,
        storageKey: written.key,
        firstUsedByDemoVersionId: version.id,
        publishedAt,
      });
      publishedAssets += 1;
      log("asset-published", { key, bytes: written.byteSize });
    }

    if (missingAssets.length > 0) {
      const message = `Missing demo asset(s) in the source store: ${missingAssets.join(", ")}`;
      await failDemoPublication(db, { publicationId: publication.id, failureMessage: message });
      return { status: "failed", demoId: demo.id, message, publication };
    }

    const publicUrl = `${baseUrl}/d/${locator.token}`;
    await completeDemoPublication(db, {
      publicationId: publication.id,
      publicUrl,
      assetCount: publishedAssets,
      detail: {
        publicationVersion: DEMO_PUBLICATION_VERSION,
        storageProvider: input.destination.provider,
        assets: references.map((reference) => `${reference.assetRef}/${reference.fileName}`),
      },
    });

    await appendEvent(db, {
      category: "domain",
      eventType: "demo_published",
      occurredAt: publishedAt,
      sourceProducer: DEMO_PUBLICATION_VERSION,
      actorType: "operator",
      actorRef: input.actorRef,
      idempotencyScope: "demo_publication",
      idempotencyKey: publication.id,
      businessId: demo.business_id,
      prospectId: demo.prospect_id,
      demoVersionId: version.id,
      ...(input.correlationId ? { correlationId: input.correlationId } : {}),
      properties: {
        demoId: demo.id,
        environment: input.environment,
        versionNumber: version.version_number,
        assetCount: publishedAssets,
      },
    });

    log("publication-completed", { demoId: demo.id, publicUrl, assets: publishedAssets });
    return {
      status: "published",
      summary: {
        demoId: demo.id,
        demoVersionId: version.id,
        versionNumber: version.version_number,
        environment: input.environment,
        publicUrl,
        publishedAssets,
        missingAssets,
        publicationId: publication.id,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await failDemoPublication(db, { publicationId: publication.id, failureMessage: message });
    log("publication-failed", { demoId: demo.id, message });
    return { status: "failed", demoId: demo.id, message, publication };
  }
}
