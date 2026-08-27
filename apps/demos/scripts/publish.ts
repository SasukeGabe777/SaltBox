/**
 * Publish an APPROVED demo version:
 *
 *   pnpm demos:publish --prospect <uuid> [--environment local|hosted]
 *   pnpm demos:publish --demo <uuid> --environment hosted --base-url https://...
 *
 * `local` records the demo's assets as published against the local artifact
 * store — useful for verifying the whole path without any cloud account.
 * `hosted` uploads them to Cloudflare R2 through the operator's wrangler login
 * so the hosted Worker can serve them.
 *
 * Publication refuses any demo without an operator-approved version.
 */

import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { createDatabase } from "@saltbox/database/client";
import { resolveDatabaseUrl } from "@saltbox/database/client/config";
import { getDemoForProspect } from "@saltbox/database/repositories/demos";
import { publishDemo } from "@saltbox/demo-generation/publish";
import { LocalArtifactStore } from "@saltbox/artifact-store/local";
import { WranglerR2ArtifactStore } from "../hosting/wrangler-r2.ts";
import { readHostingConfig } from "../hosting/config.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const { values } = parseArgs({
  options: {
    prospect: { type: "string" },
    demo: { type: "string" },
    environment: { type: "string", default: "local" },
    "base-url": { type: "string" },
    help: { type: "boolean", short: "h", default: false },
  },
  strict: true,
});

if (values.help || (!values.prospect && !values.demo)) {
  console.error(
    "Usage: pnpm demos:publish (--prospect <uuid> | --demo <uuid>) [--environment local|hosted] [--base-url <origin>]",
  );
  process.exit(values.help ? 0 : 1);
}
const environment = values.environment === "hosted" ? "hosted" : "local";
for (const [flag, value] of [
  ["prospect", values.prospect],
  ["demo", values.demo],
] as const) {
  if (value !== undefined && !UUID.test(value)) {
    console.error(`--${flag} must be a UUID.`);
    process.exit(1);
  }
}

const config = readHostingConfig(resolve(process.cwd()));
const baseUrl =
  values["base-url"] ??
  (environment === "hosted" ? process.env.SALTBOX_DEMOS_PUBLIC_BASE_URL : undefined) ??
  (environment === "hosted" ? undefined : (process.env.SALTBOX_DEMOS_BASE_URL ?? "http://127.0.0.1:5175"));
if (baseUrl === undefined) {
  console.error(
    "A hosted publication needs the public origin: pass --base-url https://<worker>.workers.dev " +
      "or set SALTBOX_DEMOS_PUBLIC_BASE_URL.",
  );
  process.exit(1);
}

const assetParent = resolve(process.cwd(), "../../.data");
const source = new LocalArtifactStore(assetParent);
const destination =
  environment === "hosted"
    ? new WranglerR2ArtifactStore({ bucket: config.bucketName, cwd: process.cwd() })
    : source;

const db = createDatabase({ connectionString: resolveDatabaseUrl(), maxConnections: 4 });
try {
  let demoId = values.demo;
  if (!demoId && values.prospect) {
    const demo = await getDemoForProspect(db, values.prospect);
    if (!demo) {
      console.error(`No live demo exists for prospect ${values.prospect}.`);
      process.exitCode = 1;
    } else {
      demoId = demo.id;
    }
  }

  if (demoId) {
    console.log(`\nSALTBOX DEMO PUBLICATION (${environment})\n`);
    const result = await publishDemo(db, {
      demoId,
      environment,
      source,
      destination,
      publicBaseUrl: baseUrl,
      actorRef: process.env.SALTBOX_OPERATOR_REF ?? "local-operator",
      log: (stage, detail) => console.log(`  ${stage} ${detail ? JSON.stringify(detail) : ""}`),
    });
    if (result.status === "published") {
      console.log(`\nPUBLISHED v${result.summary.versionNumber} -> ${result.summary.publicUrl}`);
      console.log(`Assets: ${result.summary.publishedAssets} (${destination.provider})`);
    } else if (result.status === "not_approved") {
      console.error("\nThis demo has no approved version. Approve one in the admin before publishing.");
      process.exitCode = 1;
    } else if (result.status === "not_found") {
      console.error("\nNo live demo with that identifier exists.");
      process.exitCode = 1;
    } else {
      console.error(`\nPUBLICATION FAILED: ${result.message}`);
      process.exitCode = 1;
    }
  }
} finally {
  await db.destroy();
}
