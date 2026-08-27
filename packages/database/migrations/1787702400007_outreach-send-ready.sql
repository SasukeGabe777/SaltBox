-- Up Migration

-- Phase 11: deterministic outreach preparation that stops at SEND-READY.
--
-- Message remains the provider-neutral communication intent and
-- message_attempt remains transport history. These additions pin an intent to
-- the exact operator-approved, hosted DemoVersion it was prepared against and
-- make the pre-send lifecycle explicit without introducing a provider.

-- PostgreSQL enum additions are intentionally forward-only. The new value is
-- consumed by application transactions only after this migration commits.
ALTER TYPE suppression_scope ADD VALUE IF NOT EXISTS 'prospect';

ALTER TABLE suppression
  ADD COLUMN prospect_id uuid REFERENCES prospect (id),
  ADD CONSTRAINT suppression_prospect_scope_check
    CHECK (scope::text <> 'prospect' OR prospect_id IS NOT NULL);

CREATE INDEX suppression_prospect_idx
  ON suppression (prospect_id)
  WHERE status = 'active';

ALTER TABLE message
  ADD COLUMN status text NOT NULL DEFAULT 'draft'
    CONSTRAINT message_status_check
    CHECK (status IN ('draft', 'prepared', 'send_ready', 'suppressed', 'cancelled')),
  ADD COLUMN demo_id uuid REFERENCES demo (id),
  ADD COLUMN demo_version_id uuid REFERENCES demo_version (id),
  ADD COLUMN demo_public_locator_id uuid REFERENCES demo_public_locator (id),
  ADD COLUMN demo_approval_review_id uuid REFERENCES demo_version_review (id),
  ADD COLUMN hosted_publication_id uuid REFERENCES demo_publication (id),
  ADD COLUMN approved_at_snapshot timestamptz,
  ADD COLUMN public_url text,
  ADD COLUMN selected_contact_reason text,
  ADD COLUMN selected_contact_source_ref text,
  ADD COLUMN selected_contact_confidence confidence_band,
  ADD COLUMN sender_profile_version text,
  ADD COLUMN subject_template_version text,
  ADD COLUMN body_template_version text,
  ADD COLUMN preparation_metadata jsonb,
  ADD COLUMN prepared_at timestamptz,
  ADD COLUMN send_ready_at timestamptz,
  ADD COLUMN invalidated_at timestamptz,
  ADD CONSTRAINT message_send_ready_fields_check CHECK (
    status <> 'send_ready'
    OR (
      direction = 'outbound'
      AND channel = 'email'
      AND prospect_id IS NOT NULL
      AND contact_method_id IS NOT NULL
      AND campaign_enrollment_id IS NOT NULL
      AND sequence_step IS NOT NULL
      AND subject IS NOT NULL
      AND body IS NOT NULL
      AND demo_id IS NOT NULL
      AND demo_version_id IS NOT NULL
      AND demo_public_locator_id IS NOT NULL
      AND demo_approval_review_id IS NOT NULL
      AND hosted_publication_id IS NOT NULL
      AND approved_at_snapshot IS NOT NULL
      AND public_url IS NOT NULL
      AND sender_profile_version IS NOT NULL
      AND subject_template_version IS NOT NULL
      AND body_template_version IS NOT NULL
      AND prepared_at IS NOT NULL
      AND send_ready_at IS NOT NULL
    )
  );

CREATE INDEX message_outreach_queue_idx
  ON message (status, created_at DESC)
  WHERE direction = 'outbound' AND channel = 'email';

CREATE INDEX message_prospect_campaign_step_idx
  ON message (prospect_id, campaign_enrollment_id, sequence_step, created_at DESC)
  WHERE direction = 'outbound';

INSERT INTO event_type (name, category, description) VALUES
  ('outreach_eligibility_checked', 'audit', 'Current outreach eligibility was evaluated for a prospect and exact prepared artifact.'),
  ('outreach_prepared', 'domain', 'Deterministic outreach content was prepared without contacting a provider.'),
  ('message_intent_created', 'domain', 'A provider-neutral outbound message intent was persisted.'),
  ('message_send_ready', 'domain', 'A message intent passed the Phase 11 preparation gate; no send occurred.'),
  ('outreach_suppressed', 'audit', 'An operator suppression made current and future outreach ineligible.');

-- Down Migration

DELETE FROM event_type WHERE name IN (
  'outreach_eligibility_checked', 'outreach_prepared', 'message_intent_created',
  'message_send_ready', 'outreach_suppressed'
);

DROP INDEX message_prospect_campaign_step_idx;
DROP INDEX message_outreach_queue_idx;

ALTER TABLE message
  DROP CONSTRAINT message_send_ready_fields_check,
  DROP COLUMN invalidated_at,
  DROP COLUMN send_ready_at,
  DROP COLUMN prepared_at,
  DROP COLUMN preparation_metadata,
  DROP COLUMN body_template_version,
  DROP COLUMN subject_template_version,
  DROP COLUMN sender_profile_version,
  DROP COLUMN selected_contact_confidence,
  DROP COLUMN selected_contact_source_ref,
  DROP COLUMN selected_contact_reason,
  DROP COLUMN public_url,
  DROP COLUMN approved_at_snapshot,
  DROP COLUMN hosted_publication_id,
  DROP COLUMN demo_approval_review_id,
  DROP COLUMN demo_public_locator_id,
  DROP COLUMN demo_version_id,
  DROP COLUMN demo_id,
  DROP COLUMN status;

DROP INDEX suppression_prospect_idx;
ALTER TABLE suppression
  DROP CONSTRAINT suppression_prospect_scope_check,
  DROP COLUMN prospect_id;

-- PostgreSQL cannot remove one enum value safely. The harmless forward-only
-- `prospect` label remains if this development migration is rolled back.
