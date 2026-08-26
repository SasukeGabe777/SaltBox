-- Up Migration

-- ADR-004 physical schema, part 1 of 5: shared vocabulary, identity, people,
-- provenance, entity resolution, and operator precedence.
--
-- Conventions used across all SaltBox migrations:
--   * Primary keys are application-generated opaque UUIDs; uuidv7() (core in
--     PostgreSQL 18) is only a safety-net default, never a domain identifier
--     contract.
--   * Authoritative mutable rows carry (updated_at, revision) for optimistic
--     concurrency. Append-oriented history rows have no updated_at.
--   * Polymorphic history subjects (observation, resolved_fact, ...) use
--     (subject_kind, subject_id) without a foreign key by design: the subject
--     tables span several domains and rows must survive subject archiving.
--     Referential safety for these is a domain-service responsibility.
--   * Monetary and exact-time conventions follow ADR-005 (numeric / bigint
--     minor units, timestamptz everywhere).

CREATE TYPE confidence_band AS ENUM ('verified', 'high', 'medium', 'low', 'unknown');

CREATE TYPE actor_type AS ENUM ('system', 'worker', 'local_model', 'paid_model', 'operator', 'external_webhook');

CREATE TYPE prospect_lifecycle_state AS ENUM (
  'discovered', 'enriching', 'evaluated', 'qualified', 'rejected',
  'outreach_active', 'engaged', 'sales_active', 'won', 'lost', 'paused'
);

CREATE TYPE contact_channel AS ENUM ('email', 'phone', 'sms', 'contact_form', 'social', 'postal', 'other');

CREATE TYPE message_direction AS ENUM ('inbound', 'outbound');

CREATE TYPE suppression_scope AS ENUM ('global', 'business', 'contact', 'contact_method', 'channel', 'address_pattern');

CREATE TYPE suppression_type AS ENUM ('unsubscribe', 'do_not_contact', 'complaint', 'hard_bounce', 'invalid_contact', 'operator');

CREATE TYPE suppression_status AS ENUM ('active', 'expired', 'revoked');

CREATE TYPE event_category AS ENUM ('domain', 'analytics', 'audit');

CREATE TYPE cost_class AS ENUM ('actual', 'estimated', 'allocated');

CREATE TYPE subject_kind AS ENUM ('business', 'contact', 'contact_method', 'domain', 'website', 'prospect', 'source_record');

-- Identity ------------------------------------------------------------------

CREATE TABLE business (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  canonical_name text NOT NULL,
  normalized_name text NOT NULL,
  status text NOT NULL DEFAULT 'active'
    CONSTRAINT business_status_check CHECK (status IN ('active', 'archived', 'merged')),
  merged_into_business_id uuid REFERENCES business (id),
  local_timezone text,
  category text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  revision integer NOT NULL DEFAULT 1
    CONSTRAINT business_revision_check CHECK (revision > 0),
  CONSTRAINT business_merge_target_check
    CHECK ((status = 'merged') = (merged_into_business_id IS NOT NULL))
);

CREATE INDEX business_normalized_name_idx ON business (normalized_name);
CREATE INDEX business_status_idx ON business (status);

CREATE TABLE business_identifier (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  business_id uuid NOT NULL REFERENCES business (id),
  provider text NOT NULL,
  dataset text,
  identifier_type text NOT NULL,
  value text NOT NULL,
  valid_from timestamptz,
  valid_to timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- Invariant 3: a source external ID is unique within its declared namespace.
  CONSTRAINT business_identifier_namespace_uq
    UNIQUE NULLS NOT DISTINCT (provider, dataset, identifier_type, value)
);

CREATE INDEX business_identifier_business_idx ON business_identifier (business_id);

-- People and reachability ----------------------------------------------------

CREATE TABLE contact (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  business_id uuid NOT NULL REFERENCES business (id),
  full_name text NOT NULL,
  role_title text,
  role_valid_from timestamptz,
  role_valid_to timestamptz,
  status text NOT NULL DEFAULT 'active'
    CONSTRAINT contact_status_check CHECK (status IN ('active', 'archived')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  revision integer NOT NULL DEFAULT 1
    CONSTRAINT contact_revision_check CHECK (revision > 0)
);

CREATE INDEX contact_business_idx ON contact (business_id);

CREATE TABLE contact_method (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  business_id uuid NOT NULL REFERENCES business (id),
  contact_id uuid REFERENCES contact (id),
  channel contact_channel NOT NULL,
  normalized_value text NOT NULL,
  display_value text,
  validation_status text NOT NULL DEFAULT 'unverified'
    CONSTRAINT contact_method_validation_status_check
    CHECK (validation_status IN ('unverified', 'valid', 'invalid', 'risky')),
  confidence confidence_band NOT NULL DEFAULT 'unknown',
  last_validated_at timestamptz,
  delivery_health text NOT NULL DEFAULT 'unknown'
    CONSTRAINT contact_method_delivery_health_check
    CHECK (delivery_health IN ('unknown', 'ok', 'degraded', 'failing')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  revision integer NOT NULL DEFAULT 1
    CONSTRAINT contact_method_revision_check CHECK (revision > 0),
  -- Rediscovery of the same normalized endpoint attaches provenance to the
  -- existing method instead of creating an outreach-eligible duplicate.
  CONSTRAINT contact_method_business_value_uq UNIQUE (business_id, channel, normalized_value)
);

CREATE INDEX contact_method_contact_idx ON contact_method (contact_id);
CREATE INDEX contact_method_value_idx ON contact_method (channel, normalized_value);

-- Provenance -----------------------------------------------------------------

CREATE TABLE source (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  name text NOT NULL UNIQUE,
  source_type text NOT NULL
    CONSTRAINT source_type_check CHECK (source_type IN (
      'manual', 'directory', 'map_dataset', 'registry', 'search',
      'crawl', 'social', 'webhook', 'other'
    )),
  description text,
  retention_class text NOT NULL DEFAULT 'default',
  policy jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE source_record (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  source_id uuid NOT NULL REFERENCES source (id),
  external_id text NOT NULL,
  business_id uuid REFERENCES business (id),
  retrieval_status text NOT NULL DEFAULT 'retrieved'
    CONSTRAINT source_record_retrieval_status_check
    CHECK (retrieval_status IN ('retrieved', 'partial', 'failed')),
  retrieved_at timestamptz,
  source_locator text,
  content_hash text,
  raw_evidence_ref text,
  provider_metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- Invariant 3: one provider record identity per source namespace.
  CONSTRAINT source_record_source_external_uq UNIQUE (source_id, external_id)
);

CREATE INDEX source_record_business_idx ON source_record (business_id);

CREATE TABLE observation (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  subject_kind subject_kind NOT NULL,
  subject_id uuid NOT NULL,
  field_key text NOT NULL,
  schema_version integer NOT NULL DEFAULT 1,
  value_text text,
  value_number numeric,
  value_boolean boolean,
  value_at timestamptz,
  value_json jsonb,
  unit text,
  source_id uuid NOT NULL REFERENCES source (id),
  source_record_id uuid REFERENCES source_record (id),
  observed_at timestamptz NOT NULL,
  retrieved_at timestamptz,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  confidence confidence_band NOT NULL DEFAULT 'unknown',
  verification_method text,
  freshness_policy text,
  expires_at timestamptz,
  last_verified_at timestamptz,
  evidence_ref text,
  evidence_hash text,
  evidence_summary text,
  superseded_by_observation_id uuid REFERENCES observation (id),
  supersession_reason text,
  -- Exactly one typed value per observation; JSON is a bounded, versioned
  -- value shape, never an untyped grab bag alongside another value.
  CONSTRAINT observation_single_value_check
    CHECK (num_nonnulls(value_text, value_number, value_boolean, value_at, value_json) = 1)
);

CREATE INDEX observation_subject_idx ON observation (subject_kind, subject_id, field_key, observed_at DESC);
CREATE INDEX observation_recorded_idx ON observation (recorded_at);
CREATE INDEX observation_source_record_idx ON observation (source_record_id);

-- Operator precedence --------------------------------------------------------

CREATE TABLE operator_override (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  subject_kind subject_kind NOT NULL,
  subject_id uuid NOT NULL,
  override_type text NOT NULL,
  field_key text,
  value_json jsonb,
  reason text NOT NULL,
  actor_type actor_type NOT NULL DEFAULT 'operator',
  actor_ref text NOT NULL,
  effective_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  revoked_by_actor_ref text,
  superseded_kind text,
  superseded_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT operator_override_revocation_check
    CHECK (revoked_at IS NULL OR revoked_by_actor_ref IS NOT NULL)
);

CREATE INDEX operator_override_subject_idx ON operator_override (subject_kind, subject_id);

CREATE TABLE resolved_fact (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  subject_kind subject_kind NOT NULL,
  subject_id uuid NOT NULL,
  field_key text NOT NULL,
  observation_id uuid REFERENCES observation (id),
  operator_override_id uuid REFERENCES operator_override (id),
  resolution_policy_version text NOT NULL,
  resolved_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT resolved_fact_subject_field_uq UNIQUE (subject_kind, subject_id, field_key),
  -- Invariant 5: a resolved current fact points to its supporting observation
  -- or an explicit operator override.
  CONSTRAINT resolved_fact_support_check
    CHECK (num_nonnulls(observation_id, operator_override_id) >= 1)
);

-- Entity resolution ----------------------------------------------------------

CREATE TABLE entity_match_candidate (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  subject_kind subject_kind NOT NULL
    CONSTRAINT entity_match_candidate_subject_check
    CHECK (subject_kind IN ('source_record', 'business')),
  subject_id uuid NOT NULL,
  candidate_business_id uuid NOT NULL REFERENCES business (id),
  signals jsonb NOT NULL,
  confidence confidence_band NOT NULL,
  resolution_policy_version text NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CONSTRAINT entity_match_candidate_status_check
    CHECK (status IN ('pending', 'auto_linked', 'confirmed', 'rejected')),
  resolved_at timestamptz,
  resolved_by_actor_type actor_type,
  resolved_by_actor_ref text,
  resolution_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- Invariant 4: leaving 'pending' records who resolved the candidate and why.
  CONSTRAINT entity_match_candidate_resolution_check
    CHECK (
      status = 'pending'
      OR (resolved_at IS NOT NULL AND resolved_by_actor_type IS NOT NULL AND resolution_reason IS NOT NULL)
    )
);

CREATE INDEX entity_match_candidate_subject_idx ON entity_match_candidate (subject_kind, subject_id);
CREATE INDEX entity_match_candidate_business_idx ON entity_match_candidate (candidate_business_id);
CREATE INDEX entity_match_candidate_pending_idx ON entity_match_candidate (created_at) WHERE status = 'pending';

CREATE TABLE merge_record (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  surviving_business_id uuid NOT NULL REFERENCES business (id),
  merged_business_id uuid NOT NULL REFERENCES business (id),
  entity_match_candidate_id uuid REFERENCES entity_match_candidate (id),
  actor_type actor_type NOT NULL,
  actor_ref text NOT NULL,
  reason text NOT NULL,
  resolution_policy_version text NOT NULL,
  merged_at timestamptz NOT NULL DEFAULT now(),
  reversed_at timestamptz,
  reversal_reason text,
  CONSTRAINT merge_record_distinct_check CHECK (surviving_business_id <> merged_business_id)
);

-- A business can be actively merged into at most one survivor.
CREATE UNIQUE INDEX merge_record_active_merged_uq ON merge_record (merged_business_id) WHERE reversed_at IS NULL;

-- Down Migration

DROP TABLE merge_record;
DROP TABLE entity_match_candidate;
DROP TABLE resolved_fact;
DROP TABLE operator_override;
DROP TABLE observation;
DROP TABLE source_record;
DROP TABLE source;
DROP TABLE contact_method;
DROP TABLE contact;
DROP TABLE business_identifier;
DROP TABLE business;

DROP TYPE subject_kind;
DROP TYPE cost_class;
DROP TYPE event_category;
DROP TYPE suppression_status;
DROP TYPE suppression_type;
DROP TYPE suppression_scope;
DROP TYPE message_direction;
DROP TYPE contact_channel;
DROP TYPE prospect_lifecycle_state;
DROP TYPE actor_type;
DROP TYPE confidence_band;
