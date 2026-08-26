-- Up Migration

-- ADR-004 physical schema, part 4 of 5: demo artifacts and exact published
-- revisions, outreach intent/attempt separation, conversations, and
-- suppression safety state.

-- Demo -----------------------------------------------------------------------

CREATE TABLE demo_template (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  name text NOT NULL UNIQUE,
  description text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE demo_template_version (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  demo_template_id uuid NOT NULL REFERENCES demo_template (id),
  version text NOT NULL,
  artifact_ref text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT demo_template_version_uq UNIQUE (demo_template_id, version)
);

CREATE TABLE demo (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  prospect_id uuid NOT NULL REFERENCES prospect (id),
  concept text,
  status text NOT NULL DEFAULT 'draft'
    CONSTRAINT demo_status_check
    CHECK (status IN ('draft', 'generating', 'ready', 'published', 'archived', 'expired')),
  current_demo_version_id uuid,
  archived_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  revision integer NOT NULL DEFAULT 1
    CONSTRAINT demo_revision_check CHECK (revision > 0)
);

CREATE INDEX demo_prospect_idx ON demo (prospect_id);

-- Invariant 10: a demo version belongs to exactly one demo; engagement events
-- reference the version actually served.
CREATE TABLE demo_version (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  demo_id uuid NOT NULL REFERENCES demo (id),
  version_number integer NOT NULL
    CONSTRAINT demo_version_number_check CHECK (version_number > 0),
  demo_template_version_id uuid NOT NULL REFERENCES demo_template_version (id),
  feature_set_id uuid REFERENCES feature_set (id),
  content_input_ref text,
  content_input_version text,
  generated_content_version text,
  generator_metadata jsonb,
  content_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  CONSTRAINT demo_version_uq UNIQUE (demo_id, version_number)
);

ALTER TABLE demo
  ADD CONSTRAINT demo_current_version_fk
  FOREIGN KEY (current_demo_version_id) REFERENCES demo_version (id);

-- Invariant 19: public locators are opaque, revocable, and never derived from
-- canonical internal identifiers.
CREATE TABLE demo_public_locator (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  demo_id uuid NOT NULL REFERENCES demo (id),
  token text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'active'
    CONSTRAINT demo_public_locator_status_check CHECK (status IN ('active', 'revoked', 'expired')),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  CONSTRAINT demo_public_locator_revocation_check
    CHECK (status <> 'revoked' OR revoked_at IS NOT NULL)
);

CREATE INDEX demo_public_locator_demo_idx ON demo_public_locator (demo_id);

-- Outreach -------------------------------------------------------------------

CREATE TABLE outreach_campaign (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  name text NOT NULL UNIQUE,
  strategy text,
  audience text,
  offer text,
  policy_version text NOT NULL DEFAULT '1',
  status text NOT NULL DEFAULT 'draft'
    CONSTRAINT outreach_campaign_status_check
    CHECK (status IN ('draft', 'active', 'paused', 'completed', 'cancelled')),
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  revision integer NOT NULL DEFAULT 1
    CONSTRAINT outreach_campaign_revision_check CHECK (revision > 0)
);

CREATE TABLE outreach_sequence (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  outreach_campaign_id uuid NOT NULL REFERENCES outreach_campaign (id),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT outreach_sequence_uq UNIQUE (outreach_campaign_id, name)
);

-- Immutable ordered message intents and delays for one sequence revision.
CREATE TABLE outreach_sequence_version (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  outreach_sequence_id uuid NOT NULL REFERENCES outreach_sequence (id),
  version integer NOT NULL
    CONSTRAINT outreach_sequence_version_number_check CHECK (version > 0),
  definition jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT outreach_sequence_version_uq UNIQUE (outreach_sequence_id, version)
);

CREATE TABLE campaign_enrollment (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  prospect_id uuid NOT NULL REFERENCES prospect (id),
  outreach_campaign_id uuid NOT NULL REFERENCES outreach_campaign (id),
  outreach_sequence_version_id uuid NOT NULL REFERENCES outreach_sequence_version (id),
  status text NOT NULL DEFAULT 'active'
    CONSTRAINT campaign_enrollment_status_check CHECK (status IN ('active', 'completed', 'stopped')),
  enrolled_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz
);

CREATE UNIQUE INDEX campaign_enrollment_single_active_uq
  ON campaign_enrollment (prospect_id, outreach_campaign_id)
  WHERE status = 'active';

-- Conversations --------------------------------------------------------------

CREATE TABLE conversation (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  business_id uuid NOT NULL REFERENCES business (id),
  prospect_id uuid REFERENCES prospect (id),
  primary_contact_id uuid REFERENCES contact (id),
  channel contact_channel NOT NULL,
  provider_thread_ref text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT conversation_provider_thread_uq UNIQUE (channel, provider_thread_ref)
);

CREATE INDEX conversation_business_idx ON conversation (business_id);

-- Messages: intent separated from transport attempts --------------------------

CREATE TABLE message (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  direction message_direction NOT NULL,
  channel contact_channel NOT NULL,
  business_id uuid NOT NULL REFERENCES business (id),
  prospect_id uuid REFERENCES prospect (id),
  contact_id uuid REFERENCES contact (id),
  contact_method_id uuid REFERENCES contact_method (id),
  conversation_id uuid REFERENCES conversation (id),
  campaign_enrollment_id uuid REFERENCES campaign_enrollment (id),
  sequence_step integer,
  template_ref text,
  content_version text,
  subject text,
  body text,
  body_ref text,
  scheduled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- Invariant 11 (intent half): one accepted logical send per idempotency
  -- scope, even when workers or callbacks repeat.
  idempotency_key text NOT NULL,
  CONSTRAINT message_idempotency_uq UNIQUE (channel, idempotency_key)
);

CREATE INDEX message_prospect_idx ON message (prospect_id, created_at DESC);
CREATE INDEX message_conversation_idx ON message (conversation_id);
CREATE INDEX message_scheduled_idx ON message (scheduled_at) WHERE scheduled_at IS NOT NULL;

CREATE TABLE message_attempt (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  message_id uuid NOT NULL REFERENCES message (id),
  attempt_number integer NOT NULL
    CONSTRAINT message_attempt_number_check CHECK (attempt_number > 0),
  provider text,
  provider_message_ref text,
  status text NOT NULL DEFAULT 'queued'
    CONSTRAINT message_attempt_status_check CHECK (status IN (
      'queued', 'sending', 'sent', 'delivered', 'failed', 'bounced', 'rejected', 'cancelled'
    )),
  failure_class text,
  queued_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  delivered_at timestamptz,
  bounced_at timestamptz,
  complaint_at timestamptz,
  CONSTRAINT message_attempt_uq UNIQUE (message_id, attempt_number),
  CONSTRAINT message_attempt_provider_ref_uq UNIQUE (provider, provider_message_ref)
);

-- Invariant 11 (transport half): at most one attempt per message may ever be
-- accepted as successfully sent.
CREATE UNIQUE INDEX message_attempt_single_success_uq
  ON message_attempt (message_id)
  WHERE status IN ('sent', 'delivered');

CREATE INDEX message_attempt_retry_idx ON message_attempt (status, queued_at)
  WHERE status IN ('queued', 'failed');

-- Suppression safety ---------------------------------------------------------

-- Invariants 12–13: authoritative safety state independent of lifecycle and
-- campaigns; hard suppressions survive rediscovery and merges, and removal is
-- a separately authorized, audited action that preserves the record.
CREATE TABLE suppression (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  scope suppression_scope NOT NULL,
  business_id uuid REFERENCES business (id),
  contact_id uuid REFERENCES contact (id),
  contact_method_id uuid REFERENCES contact_method (id),
  channel contact_channel,
  address_pattern text,
  suppression_type suppression_type NOT NULL,
  status suppression_status NOT NULL DEFAULT 'active',
  reason text NOT NULL,
  source_ref text,
  evidence_ref text,
  actor_type actor_type NOT NULL,
  actor_ref text,
  effective_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  revoked_by_actor_ref text,
  revoke_authorization_ref text,
  CONSTRAINT suppression_business_scope_check
    CHECK (scope <> 'business' OR business_id IS NOT NULL),
  CONSTRAINT suppression_contact_scope_check
    CHECK (scope <> 'contact' OR contact_id IS NOT NULL),
  CONSTRAINT suppression_contact_method_scope_check
    CHECK (scope <> 'contact_method' OR contact_method_id IS NOT NULL),
  CONSTRAINT suppression_channel_scope_check
    CHECK (scope <> 'channel' OR channel IS NOT NULL),
  CONSTRAINT suppression_address_scope_check
    CHECK (scope <> 'address_pattern' OR address_pattern IS NOT NULL),
  CONSTRAINT suppression_revocation_check
    CHECK (
      status <> 'revoked'
      OR (revoked_at IS NOT NULL AND revoked_by_actor_ref IS NOT NULL AND revoke_authorization_ref IS NOT NULL)
    )
);

CREATE INDEX suppression_business_idx ON suppression (business_id) WHERE status = 'active';
CREATE INDEX suppression_contact_idx ON suppression (contact_id) WHERE status = 'active';
CREATE INDEX suppression_contact_method_idx ON suppression (contact_method_id) WHERE status = 'active';
CREATE INDEX suppression_address_idx ON suppression (address_pattern) WHERE status = 'active';

-- Down Migration

DROP TABLE suppression;
DROP TABLE message_attempt;
DROP TABLE message;
DROP TABLE conversation;
DROP TABLE campaign_enrollment;
DROP TABLE outreach_sequence_version;
DROP TABLE outreach_sequence;
DROP TABLE outreach_campaign;
DROP TABLE demo_public_locator;
ALTER TABLE demo DROP CONSTRAINT demo_current_version_fk;
DROP TABLE demo_version;
DROP TABLE demo;
DROP TABLE demo_template_version;
DROP TABLE demo_template;
