/**
 * Phase 10 operator review and approval.
 *
 * THE PHASE 10 INVARIANT: only an APPROVED DemoVersion may later be used for
 * outreach. Generation does not imply approval, a QA pass does not imply
 * approval, and "latest" does not imply approval. Approval pins one exact
 * DemoVersion, is audited, and moves only when an operator says so.
 *
 * This module deliberately depends on nothing heavier than the database, so
 * the admin can call it directly inside a request without pulling a browser
 * or the intelligence stack into its process.
 */

import type { Database } from "@saltbox/database/client";
import { createDecision } from "@saltbox/database/repositories/decisions";
import {
  appendDemoVersionReview,
  getLatestDemoQaResult,
  setApprovedDemoVersion,
  type DemoQaResultRecord,
} from "@saltbox/database/repositories/demo-review";
import { appendEvent } from "@saltbox/database/repositories/events";
import { activeQualificationSuppressions } from "@saltbox/database/repositories/suppressions";

export const DEMO_APPROVAL_POLICY_VERSION = "demo-approval-policy-v1";

export type ApprovalBlockerCode =
  | "DEMO_NOT_FOUND"
  | "VERSION_NOT_FOUND"
  | "VERSION_NOT_IN_DEMO"
  | "ACTIVELY_SUPPRESSED"
  | "QA_MISSING"
  | "QA_FAILED"
  | "QA_CRITICAL_FAILURES"
  | "DEMO_ARCHIVED"
  | "CONCURRENT_MODIFICATION";

export interface ApprovalBlocker {
  code: ApprovalBlockerCode;
  detail: string;
  /** True when an explicit, audited operator override may proceed anyway. */
  overridable: boolean;
}

export interface DemoReviewActor {
  /** Stable operator identity, e.g. "local-operator". */
  actorRef: string;
}

export interface ApproveDemoVersionInput {
  demoId: string;
  demoVersionId: string;
  actor: DemoReviewActor;
  note?: string;
  /** Audited override of a failing/absent QA gate. Requires a written reason. */
  qaOverrideReason?: string;
  correlationId?: string;
}

export interface DemoApprovalSummary {
  demoId: string;
  demoVersionId: string;
  versionNumber: number;
  previousApprovedDemoVersionId: string | null;
  reviewId: string;
  qaResultId: string | null;
  qaOverride: boolean;
  approvedAt: string;
}

export type ApproveDemoVersionResult =
  | { status: "approved"; summary: DemoApprovalSummary }
  | { status: "already_approved"; summary: DemoApprovalSummary }
  | { status: "blocked"; blockers: ApprovalBlocker[] };

export interface RejectDemoVersionInput {
  demoId: string;
  demoVersionId: string;
  actor: DemoReviewActor;
  note?: string;
  correlationId?: string;
}

export type RejectDemoVersionResult =
  | {
      status: "rejected";
      reviewId: string;
      /** True when the rejected version was the approved one and approval was cleared. */
      approvalCleared: boolean;
    }
  | { status: "blocked"; blockers: ApprovalBlocker[] };

interface DemoContext {
  demoId: string;
  prospectId: string;
  businessId: string;
  demoStatus: string;
  revision: number;
  approvedDemoVersionId: string | null;
  versionNumber: number;
  suppressed: boolean;
}

async function loadContext(
  db: Database,
  demoId: string,
  demoVersionId: string,
): Promise<{ context: DemoContext } | { blockers: ApprovalBlocker[] }> {
  const demo = await db
    .selectFrom("demo")
    .innerJoin("prospect as p", "p.id", "demo.prospect_id")
    .select([
      "demo.id",
      "demo.status",
      "demo.revision",
      "demo.approved_demo_version_id",
      "p.id as prospect_id",
      "p.business_id",
    ])
    .where("demo.id", "=", demoId)
    .executeTakeFirst();
  if (!demo) {
    return { blockers: [{ code: "DEMO_NOT_FOUND", detail: `Demo ${demoId} does not exist.`, overridable: false }] };
  }
  if (demo.status === "archived" || demo.status === "expired") {
    return {
      blockers: [{ code: "DEMO_ARCHIVED", detail: `Demo ${demoId} is ${demo.status}.`, overridable: false }],
    };
  }

  const version = await db
    .selectFrom("demo_version")
    .select(["id", "demo_id", "version_number"])
    .where("id", "=", demoVersionId)
    .executeTakeFirst();
  if (!version) {
    return {
      blockers: [
        { code: "VERSION_NOT_FOUND", detail: `Demo version ${demoVersionId} does not exist.`, overridable: false },
      ],
    };
  }
  if (version.demo_id !== demoId) {
    return {
      blockers: [
        {
          code: "VERSION_NOT_IN_DEMO",
          detail: `Demo version ${demoVersionId} belongs to a different demo.`,
          overridable: false,
        },
      ],
    };
  }

  // Reuse the one suppression predicate the rest of SaltBox uses.
  const suppressions = await activeQualificationSuppressions(db, demo.business_id);

  return {
    context: {
      demoId: demo.id,
      prospectId: demo.prospect_id,
      businessId: demo.business_id,
      demoStatus: demo.status,
      revision: demo.revision,
      approvedDemoVersionId: demo.approved_demo_version_id,
      versionNumber: version.version_number,
      suppressed: suppressions.length > 0,
    },
  };
}

/**
 * QA gate: a version with recorded critical failures (or no QA evidence at
 * all) cannot be approved without an explicit, audited operator override.
 */
export function evaluateQaGate(qa: DemoQaResultRecord | undefined): ApprovalBlocker[] {
  if (!qa) {
    return [
      {
        code: "QA_MISSING",
        detail: "No automated QA result has been recorded for this version.",
        overridable: true,
      },
    ];
  }
  if (qa.criticalFailureCount > 0) {
    return [
      {
        code: "QA_CRITICAL_FAILURES",
        detail: `QA recorded ${qa.criticalFailureCount} critical failure(s): ${qa.criticalFailures.join("; ")}`,
        overridable: true,
      },
    ];
  }
  if (qa.status !== "passed") {
    return [
      {
        code: "QA_FAILED",
        detail: `The latest QA run is "${qa.status}" (${qa.checksPassed}/${qa.checksTotal} checks passed).`,
        overridable: true,
      },
    ];
  }
  return [];
}

export async function approveDemoVersion(
  db: Database,
  input: ApproveDemoVersionInput,
): Promise<ApproveDemoVersionResult> {
  const loaded = await loadContext(db, input.demoId, input.demoVersionId);
  if ("blockers" in loaded) return { status: "blocked", blockers: loaded.blockers };
  const context = loaded.context;

  const qa = await getLatestDemoQaResult(db, input.demoVersionId);

  if (context.approvedDemoVersionId === input.demoVersionId) {
    const existing = await db
      .selectFrom("demo")
      .select(["approved_at", "approval_review_id"])
      .where("id", "=", context.demoId)
      .executeTakeFirstOrThrow();
    return {
      status: "already_approved",
      summary: {
        demoId: context.demoId,
        demoVersionId: input.demoVersionId,
        versionNumber: context.versionNumber,
        previousApprovedDemoVersionId: context.approvedDemoVersionId,
        reviewId: existing.approval_review_id ?? "",
        qaResultId: qa?.id ?? null,
        qaOverride: false,
        approvedAt: (existing.approved_at ?? new Date()).toISOString(),
      },
    };
  }

  const blockers: ApprovalBlocker[] = [];
  // Suppression is never overridable from the admin (ADR-004 invariants 12–13).
  if (context.suppressed) {
    blockers.push({
      code: "ACTIVELY_SUPPRESSED",
      detail: "An active suppression covers this business; its demo cannot be approved for use.",
      overridable: false,
    });
  }
  const qaBlockers = evaluateQaGate(qa);
  const overriding = input.qaOverrideReason !== undefined && input.qaOverrideReason.trim() !== "";
  if (qaBlockers.length > 0 && !overriding) blockers.push(...qaBlockers);
  if (blockers.length > 0) return { status: "blocked", blockers };

  const approvedAt = new Date();
  const note = overriding
    ? `${input.note ? `${input.note} — ` : ""}QA override: ${input.qaOverrideReason!.trim()} (${qaBlockers
        .map((blocker) => blocker.code)
        .join(", ")})`
    : (input.note ?? null);

  const decisionId = await createDecision(db, {
    decisionType: "approve_demo",
    resultCode: "approved",
    policyVersion: DEMO_APPROVAL_POLICY_VERSION,
    actorType: "operator",
    actorRef: input.actor.actorRef,
    actionRef: input.demoVersionId,
    businessId: context.businessId,
    prospectId: context.prospectId,
    ...(input.correlationId ? { correlationId: input.correlationId } : {}),
    resultDetail: {
      demoId: context.demoId,
      demoVersionId: input.demoVersionId,
      versionNumber: context.versionNumber,
      previousApprovedDemoVersionId: context.approvedDemoVersionId,
      qaResultId: qa?.id ?? null,
      qaOverride: overriding,
    },
    reasons: [
      {
        reasonCode: overriding ? "OPERATOR_APPROVED_WITH_QA_OVERRIDE" : "OPERATOR_APPROVED",
        contribution: "supports",
        explanation: note ?? "Operator approved this demo version for use.",
        ...(qa ? { evidenceKind: "demo_version_qa_result", evidenceId: qa.id } : {}),
      },
    ],
  });

  const review = await appendDemoVersionReview(db, {
    demoId: context.demoId,
    demoVersionId: input.demoVersionId,
    action: "approved",
    actorType: "operator",
    actorRef: input.actor.actorRef,
    reasonCode: overriding ? "OPERATOR_APPROVED_WITH_QA_OVERRIDE" : "OPERATOR_APPROVED",
    ...(context.approvedDemoVersionId ? { previousApprovedDemoVersionId: context.approvedDemoVersionId } : {}),
    decisionId,
    ...(qa ? { qaResultId: qa.id } : {}),
    qaOverride: overriding,
    ...(note !== null ? { note } : {}),
    ...(input.correlationId ? { correlationId: input.correlationId } : {}),
  });

  const moved = await setApprovedDemoVersion(db, {
    demoId: context.demoId,
    expectedRevision: context.revision,
    demoVersionId: input.demoVersionId,
    actorRef: input.actor.actorRef,
    reviewId: review.id,
    approvedAt,
  });
  if (!moved) {
    return {
      status: "blocked",
      blockers: [
        {
          code: "CONCURRENT_MODIFICATION",
          detail: "The demo changed while this approval was being recorded; reload and try again.",
          overridable: false,
        },
      ],
    };
  }

  await appendEvent(db, {
    category: "domain",
    eventType: "demo_approved",
    occurredAt: approvedAt,
    sourceProducer: DEMO_APPROVAL_POLICY_VERSION,
    actorType: "operator",
    actorRef: input.actor.actorRef,
    idempotencyScope: "demo_approved",
    idempotencyKey: review.id,
    businessId: context.businessId,
    prospectId: context.prospectId,
    demoVersionId: input.demoVersionId,
    ...(input.correlationId ? { correlationId: input.correlationId } : {}),
    properties: {
      demoId: context.demoId,
      versionNumber: context.versionNumber,
      previousApprovedDemoVersionId: context.approvedDemoVersionId,
      qaOverride: overriding,
    },
  });

  if (overriding) {
    await appendEvent(db, {
      category: "audit",
      eventType: "operator_override",
      occurredAt: approvedAt,
      sourceProducer: DEMO_APPROVAL_POLICY_VERSION,
      actorType: "operator",
      actorRef: input.actor.actorRef,
      idempotencyScope: "demo_qa_override",
      idempotencyKey: review.id,
      businessId: context.businessId,
      prospectId: context.prospectId,
      demoVersionId: input.demoVersionId,
      properties: {
        demoId: context.demoId,
        blockers: qaBlockers.map((blocker) => blocker.code),
        reason: input.qaOverrideReason!.trim(),
      },
    });
  }

  return {
    status: "approved",
    summary: {
      demoId: context.demoId,
      demoVersionId: input.demoVersionId,
      versionNumber: context.versionNumber,
      previousApprovedDemoVersionId: context.approvedDemoVersionId,
      reviewId: review.id,
      qaResultId: qa?.id ?? null,
      qaOverride: overriding,
      approvedAt: approvedAt.toISOString(),
    },
  };
}

export async function rejectDemoVersion(
  db: Database,
  input: RejectDemoVersionInput,
): Promise<RejectDemoVersionResult> {
  const loaded = await loadContext(db, input.demoId, input.demoVersionId);
  if ("blockers" in loaded) return { status: "blocked", blockers: loaded.blockers };
  const context = loaded.context;
  const rejectedAt = new Date();
  const wasApproved = context.approvedDemoVersionId === input.demoVersionId;
  const qa = await getLatestDemoQaResult(db, input.demoVersionId);

  const decisionId = await createDecision(db, {
    decisionType: "reject_demo",
    resultCode: "rejected",
    policyVersion: DEMO_APPROVAL_POLICY_VERSION,
    actorType: "operator",
    actorRef: input.actor.actorRef,
    actionRef: input.demoVersionId,
    businessId: context.businessId,
    prospectId: context.prospectId,
    ...(input.correlationId ? { correlationId: input.correlationId } : {}),
    resultDetail: {
      demoId: context.demoId,
      demoVersionId: input.demoVersionId,
      versionNumber: context.versionNumber,
      clearedApproval: wasApproved,
    },
    reasons: [
      {
        reasonCode: "OPERATOR_REJECTED",
        contribution: "opposes",
        explanation: input.note ?? "Operator rejected this demo version.",
        ...(qa ? { evidenceKind: "demo_version_qa_result", evidenceId: qa.id } : {}),
      },
    ],
  });

  const review = await appendDemoVersionReview(db, {
    demoId: context.demoId,
    demoVersionId: input.demoVersionId,
    action: "rejected",
    actorType: "operator",
    actorRef: input.actor.actorRef,
    reasonCode: "OPERATOR_REJECTED",
    ...(context.approvedDemoVersionId ? { previousApprovedDemoVersionId: context.approvedDemoVersionId } : {}),
    decisionId,
    ...(qa ? { qaResultId: qa.id } : {}),
    ...(input.note ? { note: input.note } : {}),
    ...(input.correlationId ? { correlationId: input.correlationId } : {}),
  });

  // Rejecting the approved version withdraws it; nothing is promoted in its
  // place, because promotion is always an explicit approval.
  let approvalCleared = false;
  if (wasApproved) {
    approvalCleared = await setApprovedDemoVersion(db, {
      demoId: context.demoId,
      expectedRevision: context.revision,
      demoVersionId: null,
      actorRef: null,
      reviewId: null,
    });
    if (!approvalCleared) {
      return {
        status: "blocked",
        blockers: [
          {
            code: "CONCURRENT_MODIFICATION",
            detail: "The demo changed while this rejection was being recorded; reload and try again.",
            overridable: false,
          },
        ],
      };
    }
  }

  await appendEvent(db, {
    category: "domain",
    eventType: "demo_rejected",
    occurredAt: rejectedAt,
    sourceProducer: DEMO_APPROVAL_POLICY_VERSION,
    actorType: "operator",
    actorRef: input.actor.actorRef,
    idempotencyScope: "demo_rejected",
    idempotencyKey: review.id,
    businessId: context.businessId,
    prospectId: context.prospectId,
    demoVersionId: input.demoVersionId,
    ...(input.correlationId ? { correlationId: input.correlationId } : {}),
    properties: {
      demoId: context.demoId,
      versionNumber: context.versionNumber,
      approvalCleared,
    },
  });

  return { status: "rejected", reviewId: review.id, approvalCleared };
}
