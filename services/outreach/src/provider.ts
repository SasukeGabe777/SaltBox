/**
 * Phase 11 has no transport adapter, credential shape, SMTP client, or send
 * method. Delivery is therefore architecturally impossible, not merely hidden
 * behind a disabled button.
 */
export const OUTREACH_SENDING_ENABLED = false as const;

export interface OutreachSendingCapability {
  enabled: false;
  provider: null;
  reason: string;
}

export function outreachSendingCapability(): OutreachSendingCapability {
  return {
    enabled: false,
    provider: null,
    reason: "Phase 11 stops at SEND-READY; no external email provider adapter exists.",
  };
}
