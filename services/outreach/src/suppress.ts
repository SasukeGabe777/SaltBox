import type { Database } from "@saltbox/database/client";
import { appendEvent } from "@saltbox/database/repositories/events";
import { activateSuppression } from "@saltbox/database/repositories/suppressions";

export type OperatorSuppressionScope = "prospect" | "business" | "contact_method";

export async function suppressOutreach(
  db: Database,
  input: {
    prospectId: string;
    scope: OperatorSuppressionScope;
    reason: string;
    actorRef: string;
    contactMethodId?: string;
  },
): Promise<{ suppressionId: string; invalidatedMessageCount: number }> {
  const prospect = await db
    .selectFrom("prospect")
    .select(["id", "business_id"])
    .where("id", "=", input.prospectId)
    .executeTakeFirstOrThrow();
  if (input.scope === "contact_method" && !input.contactMethodId) {
    throw new Error("A contact-method suppression requires the selected contact method.");
  }
  if (input.scope === "contact_method") {
    const contactMethod = await db.selectFrom("contact_method").select("id").where("id", "=", input.contactMethodId as string).where("business_id", "=", prospect.business_id).executeTakeFirst();
    if (!contactMethod) throw new Error("The selected contact method does not belong to this prospect's business.");
  }
  const reason = input.reason.trim();
  if (reason.length < 3 || reason.length > 400) throw new Error("A suppression reason between 3 and 400 characters is required.");

  return db.transaction().execute(async (trx) => {
    const suppressionId = await activateSuppression(trx, {
      scope: input.scope,
      suppressionType: "do_not_contact",
      reason,
      actorType: "operator",
      actorRef: input.actorRef,
      ...(input.scope === "business" ? { businessId: prospect.business_id } : {}),
      ...(input.scope === "prospect" ? { prospectId: prospect.id } : {}),
      ...(input.scope === "contact_method" ? { contactMethodId: input.contactMethodId } : {}),
      sourceRef: "admin:phase11",
    });
    let update = trx
      .updateTable("message")
      .set({ status: "suppressed", invalidated_at: new Date() })
      .where("direction", "=", "outbound")
      .where("channel", "=", "email")
      .where("status", "in", ["draft", "prepared", "send_ready"]);
    update = input.scope === "business"
      ? update.where("business_id", "=", prospect.business_id)
      : input.scope === "contact_method"
        ? update.where("contact_method_id", "=", input.contactMethodId as string)
        : update.where("prospect_id", "=", prospect.id);
    const invalidated = await update.executeTakeFirst();
    await appendEvent(trx, {
      category: "audit",
      eventType: "outreach_suppressed",
      occurredAt: new Date(),
      sourceProducer: "outreach-foundations-v1",
      actorType: "operator",
      actorRef: input.actorRef,
      businessId: prospect.business_id,
      prospectId: prospect.id,
      idempotencyScope: "operator-outreach-suppression",
      idempotencyKey: suppressionId,
      properties: { scope: input.scope, suppressionId, invalidatedMessageCount: Number(invalidated.numUpdatedRows) },
    });
    return { suppressionId, invalidatedMessageCount: Number(invalidated.numUpdatedRows) };
  });
}
