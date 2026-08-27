export const OUTREACH_POLICY_VERSION = "outreach-eligibility-v1";
export const CAMPAIGN_NAME = "SaltBox Demo Outreach — Local Services v1";
export const CAMPAIGN_VERSION = "1";
export const SEQUENCE_NAME = "saltbox-demo-outreach";
export const SEQUENCE_VERSION = 1;
export const OUTREACH_CONTENT_VERSION = "saltbox-demo-email-v1";
export const SUBJECT_TEMPLATE_VERSION = "outreach-subject-rebuilt-v1";
export const BODY_TEMPLATE_VERSION = "outreach-body-demo-v1";
export const SENDER_PROFILE_VERSION = "saltbox-sender-v1";
export const RECENT_OUTREACH_DAYS = 30;
export const MAX_BULK_PREPARATION = 10;

export const SEQUENCE_DEFINITION = {
  schemaVersion: 1,
  noAutomaticScheduling: true,
  steps: [
    { step: 1, key: "initial_demo_email", delayDays: 0, phase11: "prepare" },
    { step: 2, key: "future_follow_up", delayDays: 4, phase11: "model_only" },
    { step: 3, key: "future_final_follow_up", delayDays: 7, phase11: "model_only" },
  ],
} as const;

export interface SenderProfile {
  version: typeof SENDER_PROFILE_VERSION;
  displayName: string;
  businessIdentity: string;
  email: string | null;
  replyTo: string | null;
  mailingAddress: string | null;
  phase12Requirements: string[];
}

/**
 * Sender identity is configuration, never invented content. Phase 11 needs
 * only the real SaltBox display identity for preview. Missing transport and
 * compliance fields are explicit Phase 12 requirements and never receive
 * fake defaults.
 */
export function senderProfile(env: NodeJS.ProcessEnv = process.env): SenderProfile {
  const email = value(env.SALTBOX_OUTREACH_SENDER_EMAIL);
  const replyTo = value(env.SALTBOX_OUTREACH_REPLY_TO);
  const mailingAddress = value(env.SALTBOX_OUTREACH_MAILING_ADDRESS);
  const requirements: string[] = [];
  if (!email) requirements.push("Configure a verified sender email before enabling delivery.");
  if (!replyTo) requirements.push("Configure a monitored reply-to address before enabling delivery.");
  if (!mailingAddress) requirements.push("Configure SaltBox's real mailing address/footer before enabling delivery.");
  return {
    version: SENDER_PROFILE_VERSION,
    displayName: value(env.SALTBOX_OUTREACH_SENDER_NAME) ?? "SaltBox",
    businessIdentity: value(env.SALTBOX_OUTREACH_BUSINESS_IDENTITY) ?? "SaltBox",
    email,
    replyTo,
    mailingAddress,
    phase12Requirements: requirements,
  };
}

function value(input: string | undefined): string | null {
  const trimmed = input?.trim();
  return trimmed ? trimmed : null;
}
