/**
 * Operator review of a demo version from the command line:
 *
 *   pnpm demo:review --demo <uuid> --version <n> --approve [--note "..."]
 *   pnpm demo:review --demo <uuid> --version <n> --reject  [--note "..."]
 *   pnpm demo:review --demo <uuid>                          # show the versions
 *
 * The admin is the normal place to do this, but it only ever talks to one
 * database. This exists for environments the admin is not pointed at (a
 * hosted staging database, for example) and calls exactly the same domain
 * service, so the approval invariant, the QA gate, suppression, audit
 * history, and events behave identically.
 */

import { parseArgs } from "node:util";
import { createDatabase } from "@saltbox/database/client";
import { resolveDatabaseUrl } from "@saltbox/database/client/config";
import { approveDemoVersion, rejectDemoVersion } from "../src/approval.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const { values } = parseArgs({
  options: {
    demo: { type: "string" },
    version: { type: "string" },
    approve: { type: "boolean", default: false },
    reject: { type: "boolean", default: false },
    note: { type: "string" },
    "qa-override": { type: "string" },
    help: { type: "boolean", short: "h", default: false },
  },
  strict: true,
});

if (values.help || !values.demo || !UUID.test(values.demo)) {
  console.error(
    'Usage: pnpm demo:review --demo <uuid> [--version <n> (--approve | --reject)] [--note "..."] [--qa-override "..."]',
  );
  process.exit(values.help ? 0 : 1);
}
if (values.approve && values.reject) {
  console.error("Choose either --approve or --reject.");
  process.exit(1);
}

const actorRef = process.env.SALTBOX_OPERATOR_REF?.trim() || "local-operator";
const db = createDatabase({ connectionString: resolveDatabaseUrl(), maxConnections: 3 });

try {
  const demo = await db
    .selectFrom("demo")
    .select(["id", "status", "current_demo_version_id", "approved_demo_version_id"])
    .where("id", "=", values.demo)
    .executeTakeFirst();
  if (!demo) {
    console.error(`No demo ${values.demo} exists in this database.`);
    process.exitCode = 1;
  } else {
    const versions = await db
      .selectFrom("demo_version as dv")
      .leftJoinLateral(
        (eb) =>
          eb
            .selectFrom("demo_version_qa_result as qa")
            .select(["qa.status", "qa.checks_passed", "qa.checks_total", "qa.critical_failure_count"])
            .whereRef("qa.demo_version_id", "=", "dv.id")
            .orderBy("qa.completed_at", "desc")
            .limit(1)
            .as("qa"),
        (join) => join.onTrue(),
      )
      .select([
        "dv.id",
        "dv.version_number",
        "dv.created_at",
        "qa.status as qa_status",
        "qa.checks_passed",
        "qa.checks_total",
        "qa.critical_failure_count",
      ])
      .where("dv.demo_id", "=", demo.id)
      .orderBy("dv.version_number")
      .execute();

    console.log(`\nDEMO ${demo.id} (${demo.status})`);
    for (const version of versions) {
      const marks = [
        version.id === demo.current_demo_version_id ? "current" : "",
        version.id === demo.approved_demo_version_id ? "APPROVED" : "",
      ]
        .filter(Boolean)
        .join(" ");
      const qa = version.qa_status
        ? `QA ${version.qa_status} ${version.checks_passed}/${version.checks_total}` +
          (version.critical_failure_count ? ` (${version.critical_failure_count} critical)` : "")
        : "QA not run";
      console.log(`  v${version.version_number}  ${qa}  ${marks}`);
    }

    if (values.version !== undefined && (values.approve || values.reject)) {
      const target = versions.find((version) => String(version.version_number) === values.version);
      if (!target) {
        console.error(`\nDemo ${demo.id} has no version ${values.version}.`);
        process.exitCode = 1;
      } else if (values.approve) {
        const result = await approveDemoVersion(db, {
          demoId: demo.id,
          demoVersionId: target.id,
          actor: { actorRef },
          ...(values.note ? { note: values.note } : {}),
          ...(values["qa-override"] ? { qaOverrideReason: values["qa-override"] } : {}),
        });
        report(result.status, result.status === "blocked" ? result.blockers : undefined, target.version_number);
      } else {
        const result = await rejectDemoVersion(db, {
          demoId: demo.id,
          demoVersionId: target.id,
          actor: { actorRef },
          ...(values.note ? { note: values.note } : {}),
        });
        report(result.status, result.status === "blocked" ? result.blockers : undefined, target.version_number);
      }
    }
  }
} finally {
  await db.destroy();
}

function report(status: string, blockers: Array<{ code: string; detail: string }> | undefined, version: number): void {
  if (blockers) {
    console.error(`\nBLOCKED for v${version}:`);
    for (const blocker of blockers) console.error(`  [${blocker.code}] ${blocker.detail}`);
    process.exitCode = 1;
    return;
  }
  console.log(`\n${status.toUpperCase()} v${version} (actor ${actorRef}).`);
}
