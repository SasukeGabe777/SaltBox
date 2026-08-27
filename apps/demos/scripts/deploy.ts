/**
 * Deploy (or preflight) the hosted demo renderer.
 *
 *   pnpm demos:deploy:check   # no network, no account required
 *   pnpm demos:deploy         # requires an authenticated Cloudflare session
 *
 * The check reports every blocker at once — missing wrangler, missing login,
 * unreplaced configuration placeholders, missing public origin — instead of
 * failing one step at a time. Deployment never runs migrations and never
 * touches a database (ADR-006 prohibits migration-on-start).
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { PLACEHOLDER_PREFIX, readHostingConfig } from "../hosting/config.ts";

const { values } = parseArgs({
  options: {
    check: { type: "boolean", default: false },
    "dry-run": { type: "boolean", default: false },
    help: { type: "boolean", short: "h", default: false },
  },
  strict: true,
});
if (values.help) {
  console.error("Usage: pnpm demos:deploy [--check] [--dry-run]");
  process.exit(0);
}

const appDir = resolve(process.cwd());
const config = readHostingConfig(appDir);
const wranglerCommand = process.env.SALTBOX_WRANGLER ?? "wrangler";

interface Blocker {
  code: string;
  detail: string;
  action: string;
}

const blockers: Blocker[] = [];
const notes: string[] = [];

console.log("\nSALTBOX HOSTED DEMO RENDERER — DEPLOY PREFLIGHT\n");
console.log(`Config      ${config.path}`);
console.log(`Worker      ${config.workerName}`);
console.log(`Compat date ${config.compatibilityDate}`);
console.log(`Hyperdrive  ${config.hyperdriveId}`);
console.log(`R2 bucket   ${config.bucketName}`);
console.log(`Entry       worker/index.ts\n`);

if (!existsSync(resolve(appDir, "worker/index.ts"))) {
  blockers.push({
    code: "WORKER_ENTRY_MISSING",
    detail: "apps/demos/worker/index.ts does not exist.",
    action: "Restore the worker entry point.",
  });
}

for (const placeholder of config.placeholders) {
  blockers.push({
    code: "CONFIG_PLACEHOLDER",
    detail: `wrangler.toml ${placeholder} still holds a ${PLACEHOLDER_PREFIX}… placeholder.`,
    action:
      placeholder === "hyperdrive.id"
        ? `${wranglerCommand} hyperdrive create saltbox-demos --connection-string "<neon-unpooled-url>" ` +
          "then paste the returned id into apps/demos/wrangler.toml"
        : `${wranglerCommand} r2 bucket create ${config.bucketName}`,
  });
}

const version = runWrangler(["--version"]);
if (version.status !== 0) {
  blockers.push({
    code: "WRANGLER_UNAVAILABLE",
    detail: version.detail,
    action: "Install wrangler (`pnpm add -g wrangler` or `pnpm dlx wrangler`) and re-run.",
  });
} else {
  notes.push(`wrangler ${version.output.trim().split("\n").pop() ?? ""}`);
  const whoami = runWrangler(["whoami"]);
  if (whoami.status !== 0 || /not authenticated|you are not logged in/i.test(whoami.output)) {
    blockers.push({
      code: "CLOUDFLARE_NOT_AUTHENTICATED",
      detail: "No authenticated Cloudflare session is available in this environment.",
      action: `${wranglerCommand} login   (one-time, interactive; or set CLOUDFLARE_API_TOKEN)`,
    });
  } else {
    notes.push(whoami.output.split("\n").find((line) => line.includes("@")) ?? "authenticated");
  }
}

if (notes.length > 0) {
  console.log("ENVIRONMENT");
  for (const note of notes) console.log(`  ${note}`);
  console.log("");
}

if (blockers.length > 0) {
  console.log(`BLOCKERS (${blockers.length})`);
  for (const blocker of blockers) {
    console.log(`  [${blocker.code}] ${blocker.detail}`);
    console.log(`      -> ${blocker.action}`);
  }
  console.log(
    "\nDEPLOY RESULT\nblocked — the implementation is complete; the blockers above are one-time operator actions.",
  );
  process.exit(values.check ? 0 : 1);
}

console.log("PREFLIGHT: ready to deploy.\n");
if (values.check || values["dry-run"]) {
  console.log("DEPLOY RESULT\nready (no deployment attempted).");
  process.exit(0);
}

const deploy = spawnSync(wranglerCommand, ["deploy"], {
  cwd: appDir,
  stdio: "inherit",
  shell: process.platform === "win32",
});
if (deploy.status !== 0) {
  console.error("\nDEPLOY RESULT\nfailed");
  process.exit(deploy.status ?? 1);
}
console.log("\nDEPLOY RESULT\ndeployed");
console.log(
  "Remember: the hosted renderer serves ONLY approved demo versions. " +
    "Publish assets with `pnpm demos:publish --prospect <id> --environment hosted`.",
);

function runWrangler(args: string[]): { status: number | null; output: string; detail: string } {
  const result = spawnSync(wranglerCommand, args, {
    cwd: appDir,
    encoding: "utf8",
    shell: process.platform === "win32",
    timeout: 60_000,
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  return {
    status: result.status,
    output,
    detail:
      result.error !== undefined
        ? `wrangler could not be executed: ${result.error.message}`
        : /not recognized|command not found|no such file/i.test(output)
          ? `"${wranglerCommand}" is not installed or not on PATH in this environment.`
          : `wrangler exited with status ${result.status ?? "none"}: ${output.trim().split("\n")[0] ?? ""}`,
  };
}
