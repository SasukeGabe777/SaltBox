-- Up Migration

-- ADR-004 physical schema, part 5 of 5: canonical event registry and envelope,
-- experiments with actual exposure, commercial outcomes, and the cost ledger.

-- Experiments ----------------------------------------------------------------

CREATE TABLE experiment (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  name text NOT NULL UNIQUE,
  hypothesis text,
  status text NOT NULL DEFAULT 'draft'
    CONSTRAINT experiment_status_check
    CHECK (status IN ('draft', 'active', 'paused', 'completed', 'cancelled')),
  eligibility_version text,
  assignment_strategy text,
  assignment_version text NOT NULL DEFAULT '1',
  primary_metric text,
  guardrails jsonb,
  active_from timestamptz,
  active_to timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  revision integer NOT NULL DEFAULT 1
    CONSTRAINT experiment_revision_check CHECK (revision > 0)
);

CREATE TABLE variant (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  experiment_id uuid NOT NULL REFERENCES experiment (id),
  name text NOT NULL,
  version text NOT NULL DEFAULT '1',
  is_control boolean NOT NULL DEFAULT false,
  content_ref text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT variant_uq UNIQUE (experiment_id, name, version)
);

-- Invariant 14 (assignment half): deterministic assignment cannot silently
-- change variant for the same subject and assignment version.
CREATE TABLE experiment_assignment (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  experiment_id uuid NOT NULL REFERENCES experiment (id),
  variant_id uuid NOT NULL REFERENCES variant (id),
  subject_kind text NOT NULL,
  subject_key text NOT NULL,
  assignment_version text NOT NULL,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT experiment_assignment_uq
    UNIQUE (experiment_id, subject_kind, subject_key, assignment_version)
);

-- Invariant 14 (exposure half): what was actually rendered/delivered/seen,
-- referencing the concrete variant and artifact revision.
CREATE TABLE experiment_exposure (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  experiment_id uuid NOT NULL REFERENCES experiment (id),
  variant_id uuid NOT NULL REFERENCES variant (id),
  experiment_assignment_id uuid REFERENCES experiment_assignment (id),
  prospect_id uuid REFERENCES prospect (id),
  subject_kind text,
  subject_key text,
  assigned_at timestamptz,
  exposed_at timestamptz NOT NULL,
  channel text,
  surface text,
  demo_version_id uuid REFERENCES demo_version (id),
  message_id uuid REFERENCES message (id),
  context jsonb,
  recorded_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX experiment_exposure_experiment_idx ON experiment_exposure (experiment_id, exposed_at);
CREATE INDEX experiment_exposure_prospect_idx ON experiment_exposure (prospect_id);

-- Commercial -----------------------------------------------------------------

CREATE TABLE customer (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  business_id uuid NOT NULL REFERENCES business (id),
  -- Invariants 1–2: conversion references, never replaces, the prospect.
  originating_prospect_id uuid REFERENCES prospect (id),
  account_scope text NOT NULL DEFAULT 'default',
  status text NOT NULL DEFAULT 'active'
    CONSTRAINT customer_status_check CHECK (status IN ('active', 'suspended', 'churned')),
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  revision integer NOT NULL DEFAULT 1
    CONSTRAINT customer_revision_check CHECK (revision > 0)
);

-- Duplicate active accounts must not arise accidentally.
CREATE UNIQUE INDEX customer_single_active_account_uq
  ON customer (business_id, account_scope)
  WHERE status = 'active';

CREATE INDEX customer_business_idx ON customer (business_id);

CREATE TABLE subscription (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  customer_id uuid NOT NULL REFERENCES customer (id),
  plan_ref text NOT NULL,
  plan_version text,
  status text NOT NULL DEFAULT 'active'
    CONSTRAINT subscription_status_check
    CHECK (status IN ('active', 'past_due', 'cancelled', 'ended')),
  provider text,
  provider_ref text,
  started_at timestamptz NOT NULL,
  cancelled_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  revision integer NOT NULL DEFAULT 1
    CONSTRAINT subscription_revision_check CHECK (revision > 0),
  CONSTRAINT subscription_provider_ref_uq UNIQUE (provider, provider_ref)
);

CREATE INDEX subscription_customer_idx ON subscription (customer_id);

-- Invariant 16: money is exact minor units with explicit currency.
CREATE TABLE purchase (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  customer_id uuid NOT NULL REFERENCES customer (id),
  prospect_id uuid REFERENCES prospect (id),
  experiment_exposure_id uuid REFERENCES experiment_exposure (id),
  subscription_id uuid REFERENCES subscription (id),
  offer_ref text NOT NULL,
  package_version text,
  amount_minor bigint NOT NULL
    CONSTRAINT purchase_amount_check CHECK (amount_minor >= 0),
  currency char(3) NOT NULL,
  provider text NOT NULL,
  provider_ref text,
  status text NOT NULL
    CONSTRAINT purchase_status_check CHECK (status IN ('pending', 'succeeded', 'failed', 'cancelled')),
  occurred_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT purchase_provider_ref_uq UNIQUE (provider, provider_ref)
);

CREATE INDEX purchase_customer_idx ON purchase (customer_id, occurred_at DESC);

-- Invariant 17: a refund references the original purchase and never rewrites it.
CREATE TABLE refund (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  purchase_id uuid NOT NULL REFERENCES purchase (id),
  amount_minor bigint NOT NULL
    CONSTRAINT refund_amount_check CHECK (amount_minor > 0),
  currency char(3) NOT NULL,
  provider text NOT NULL,
  provider_ref text,
  reason text,
  occurred_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT refund_provider_ref_uq UNIQUE (provider, provider_ref)
);

CREATE INDEX refund_purchase_idx ON refund (purchase_id);

-- Conversations may later belong to a customer relationship as well.
ALTER TABLE conversation
  ADD COLUMN customer_id uuid REFERENCES customer (id);

-- Cost ledger ----------------------------------------------------------------

CREATE TABLE cost_entry (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  amount numeric(18, 6) NOT NULL
    CONSTRAINT cost_entry_amount_check CHECK (amount <> 0),
  currency char(3) NOT NULL,
  cost_class cost_class NOT NULL,
  category text NOT NULL
    CONSTRAINT cost_entry_category_check CHECK (category IN (
      'data_acquisition', 'enrichment', 'proxy', 'local_inference_estimate',
      'paid_inference', 'email', 'image_generation', 'hosting', 'storage',
      'database', 'human_labor', 'other'
    )),
  provider text,
  units numeric,
  unit_price numeric,
  pricing_version text,
  business_id uuid REFERENCES business (id),
  prospect_id uuid REFERENCES prospect (id),
  customer_id uuid REFERENCES customer (id),
  outreach_campaign_id uuid REFERENCES outreach_campaign (id),
  message_attempt_id uuid REFERENCES message_attempt (id),
  demo_version_id uuid REFERENCES demo_version (id),
  purchase_id uuid REFERENCES purchase (id),
  run_id uuid,
  job_id uuid,
  -- Corrections are reversing/adjusting entries, never silent edits.
  reverses_cost_entry_id uuid REFERENCES cost_entry (id),
  note text,
  occurred_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX cost_entry_prospect_idx ON cost_entry (prospect_id, occurred_at);
CREATE INDEX cost_entry_customer_idx ON cost_entry (customer_id, occurred_at);
CREATE INDEX cost_entry_category_idx ON cost_entry (category, occurred_at);

-- Canonical event registry and envelope ---------------------------------------

-- Invariant 15: event type and properties conform to a registered schema
-- version. The composite foreign key below also guarantees the envelope
-- category always matches the registry's category for that type.
CREATE TABLE event_type (
  name text PRIMARY KEY,
  category event_category NOT NULL,
  owner text NOT NULL DEFAULT 'saltbox',
  description text NOT NULL,
  required_context jsonb,
  properties_schema jsonb,
  privacy_class text NOT NULL DEFAULT 'internal',
  compatibility_policy text NOT NULL DEFAULT 'additive',
  current_schema_version integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'active'
    CONSTRAINT event_type_status_check CHECK (status IN ('active', 'deprecated')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_type_name_category_uq UNIQUE (name, category)
);

CREATE TABLE event (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  category event_category NOT NULL,
  event_type text NOT NULL,
  schema_version integer NOT NULL DEFAULT 1,
  occurred_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  business_id uuid REFERENCES business (id),
  prospect_id uuid REFERENCES prospect (id),
  customer_id uuid REFERENCES customer (id),
  contact_id uuid REFERENCES contact (id),
  demo_version_id uuid REFERENCES demo_version (id),
  message_id uuid REFERENCES message (id),
  outreach_campaign_id uuid REFERENCES outreach_campaign (id),
  purchase_id uuid REFERENCES purchase (id),
  experiment_exposure_id uuid REFERENCES experiment_exposure (id),
  source_producer text NOT NULL,
  actor_type actor_type NOT NULL,
  actor_ref text,
  correlation_id uuid,
  causation_id uuid,
  run_id uuid,
  job_id uuid,
  external_ref text,
  idempotency_scope text NOT NULL,
  idempotency_key text NOT NULL,
  properties jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT event_type_category_fk
    FOREIGN KEY (event_type, category) REFERENCES event_type (name, category),
  -- Invariant 15: idempotency keys are unique within their declared scope.
  CONSTRAINT event_idempotency_uq UNIQUE (idempotency_scope, idempotency_key)
);

CREATE INDEX event_business_idx ON event (business_id, occurred_at);
CREATE INDEX event_prospect_idx ON event (prospect_id, occurred_at);
CREATE INDEX event_type_time_idx ON event (event_type, occurred_at);
CREATE INDEX event_recorded_idx ON event (recorded_at);
CREATE INDEX event_correlation_idx ON event (correlation_id);

-- Initial event registry (ADR-004 canonical semantic contracts, not provider
-- webhook names).
INSERT INTO event_type (name, category, description) VALUES
  ('email_queued', 'domain', 'An outreach email intent was accepted for delivery.'),
  ('email_sent', 'domain', 'A provider accepted an outreach email send.'),
  ('email_delivered', 'domain', 'A provider reported delivery of an outreach email.'),
  ('email_bounced', 'domain', 'A provider reported an outreach email bounce.'),
  ('email_complaint', 'domain', 'A recipient complaint (spam report) was received.'),
  ('unsubscribe', 'domain', 'A recipient opted out of further outreach.'),
  ('reply_received', 'domain', 'An inbound reply was received on a conversation.'),
  ('positive_reply', 'domain', 'An inbound reply was classified as positive interest.'),
  ('negative_reply', 'domain', 'An inbound reply was classified as negative.'),
  ('prospect_state_changed', 'domain', 'A prospect lifecycle transition was recorded.'),
  ('prospect_qualified', 'domain', 'A qualification decision authorized pursuit of a prospect.'),
  ('demo_published', 'domain', 'A demo version became publicly visible.'),
  ('customer_won', 'domain', 'An acquisition pursuit converted into a customer.'),
  ('subscription_started', 'domain', 'A customer subscription became active.'),
  ('subscription_cancelled', 'domain', 'A customer subscription was cancelled.'),
  ('purchase', 'domain', 'A commercial purchase succeeded.'),
  ('refund', 'domain', 'A refund was recorded against a purchase.'),
  ('demo_view', 'analytics', 'A public demo version was viewed.'),
  ('demo_engaged', 'analytics', 'A demo viewer crossed the engagement threshold.'),
  ('demo_cta_click', 'analytics', 'A demo call-to-action was clicked.'),
  ('landing_view', 'analytics', 'A marketing landing page was viewed.'),
  ('pricing_view', 'analytics', 'The pricing section or page was viewed.'),
  ('contact_started', 'analytics', 'A visitor began the contact/quote flow.'),
  ('contact_submitted', 'analytics', 'A visitor completed the contact/quote flow.'),
  ('checkout_started', 'analytics', 'A checkout flow was started.'),
  ('operator_override', 'audit', 'An operator override superseded automated resolution.'),
  ('lead_score_recalculated', 'audit', 'A historical feature set was rescored under a new scoring version.'),
  ('business_merged', 'audit', 'Two business identities were merged after resolution.'),
  ('suppression_activated', 'audit', 'A suppression safety record became active.'),
  ('suppression_removed', 'audit', 'An active suppression was revoked through separate authorization.');

-- Down Migration

DROP TABLE event;
DROP TABLE event_type;
DROP TABLE cost_entry;
ALTER TABLE conversation DROP COLUMN customer_id;
DROP TABLE refund;
DROP TABLE purchase;
DROP TABLE subscription;
DROP TABLE customer;
DROP TABLE experiment_exposure;
DROP TABLE experiment_assignment;
DROP TABLE variant;
DROP TABLE experiment;
