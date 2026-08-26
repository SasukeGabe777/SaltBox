-- Up Migration

-- ADR-004 physical schema, part 3 of 5: prospect lifecycle, immutable feature
-- snapshots, versioned scoring, and first-class decisions.

CREATE TABLE prospect (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  business_id uuid NOT NULL REFERENCES business (id),
  market_scope text NOT NULL DEFAULT 'default',
  offer_scope text NOT NULL DEFAULT 'default',
  lifecycle_state prospect_lifecycle_state NOT NULL DEFAULT 'discovered',
  state_changed_at timestamptz NOT NULL DEFAULT now(),
  opened_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  revision integer NOT NULL DEFAULT 1
    CONSTRAINT prospect_revision_check CHECK (revision > 0),
  CONSTRAINT prospect_closed_state_check
    CHECK ((closed_at IS NOT NULL) = (lifecycle_state IN ('rejected', 'won', 'lost')))
);

-- One active acquisition pursuit per business and market/offer scope; closed
-- pursuits remain and a genuinely new pursuit creates a new prospect.
CREATE UNIQUE INDEX prospect_single_active_pursuit_uq
  ON prospect (business_id, market_scope, offer_scope)
  WHERE lifecycle_state NOT IN ('rejected', 'won', 'lost');

CREATE INDEX prospect_state_idx ON prospect (lifecycle_state, state_changed_at);
CREATE INDEX prospect_business_idx ON prospect (business_id);

-- Learning inputs ------------------------------------------------------------

CREATE TABLE feature_definition (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  name text NOT NULL UNIQUE,
  data_type text NOT NULL
    CONSTRAINT feature_definition_data_type_check
    CHECK (data_type IN ('text', 'number', 'boolean', 'timestamp', 'json')),
  unit text,
  description text NOT NULL,
  valid_domain jsonb,
  owner text NOT NULL DEFAULT 'saltbox',
  version integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'active'
    CONSTRAINT feature_definition_status_check CHECK (status IN ('active', 'deprecated')),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Immutable point-in-time input snapshot for one prospect. The stable typed
-- feature contract lives in columns; governed extensions live in
-- feature_set_value against the feature_definition registry.
CREATE TABLE feature_set (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  prospect_id uuid NOT NULL REFERENCES prospect (id),
  feature_schema_version text NOT NULL,
  pipeline_version text NOT NULL,
  as_of timestamptz NOT NULL,
  calculated_at timestamptz NOT NULL DEFAULT now(),
  review_count integer,
  reviews_last_90_days integer,
  rating numeric(3, 2),
  website_performance_score integer
    CONSTRAINT feature_set_performance_range_check
    CHECK (website_performance_score IS NULL OR website_performance_score BETWEEN 0 AND 100),
  mobile_pass boolean,
  email_available boolean,
  business_category text,
  ad_activity_signal text
);

CREATE INDEX feature_set_prospect_idx ON feature_set (prospect_id, as_of DESC);

CREATE TABLE feature_set_value (
  feature_set_id uuid NOT NULL REFERENCES feature_set (id),
  feature_definition_id uuid NOT NULL REFERENCES feature_definition (id),
  value_text text,
  value_number numeric,
  value_boolean boolean,
  value_at timestamptz,
  value_json jsonb,
  PRIMARY KEY (feature_set_id, feature_definition_id),
  CONSTRAINT feature_set_value_single_value_check
    CHECK (num_nonnulls(value_text, value_number, value_boolean, value_at, value_json) = 1)
);

-- Feature lineage: which observation/analysis/prior snapshot produced the
-- material features of this set, and under which transformation.
CREATE TABLE feature_set_lineage (
  feature_set_id uuid NOT NULL REFERENCES feature_set (id),
  input_kind text NOT NULL
    CONSTRAINT feature_set_lineage_kind_check
    CHECK (input_kind IN ('observation', 'website_analysis', 'feature_set')),
  input_id uuid NOT NULL,
  transformation text,
  PRIMARY KEY (feature_set_id, input_kind, input_id)
);

-- Scoring --------------------------------------------------------------------

CREATE TABLE scoring_version (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  name text NOT NULL UNIQUE,
  input_schema_version text NOT NULL,
  artifact_version text NOT NULL,
  description text,
  active_from timestamptz,
  active_to timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE lead_score (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  prospect_id uuid NOT NULL REFERENCES prospect (id),
  feature_set_id uuid NOT NULL REFERENCES feature_set (id),
  scoring_version_id uuid NOT NULL REFERENCES scoring_version (id),
  overall_score integer NOT NULL
    CONSTRAINT lead_score_overall_range_check CHECK (overall_score BETWEEN 0 AND 100),
  need_score integer
    CONSTRAINT lead_score_need_range_check CHECK (need_score IS NULL OR need_score BETWEEN 0 AND 100),
  value_score integer
    CONSTRAINT lead_score_value_range_check CHECK (value_score IS NULL OR value_score BETWEEN 0 AND 100),
  activity_score integer
    CONSTRAINT lead_score_activity_range_check CHECK (activity_score IS NULL OR activity_score BETWEEN 0 AND 100),
  reachability_score integer
    CONSTRAINT lead_score_reachability_range_check CHECK (reachability_score IS NULL OR reachability_score BETWEEN 0 AND 100),
  validation_status text NOT NULL DEFAULT 'unvalidated'
    CONSTRAINT lead_score_validation_check CHECK (validation_status IN ('unvalidated', 'valid', 'invalid')),
  calculated_at timestamptz NOT NULL DEFAULT now(),
  -- Invariant 7: rescoring appends a new (feature_set, scoring_version) result;
  -- the same pair is never evaluated into two conflicting rows.
  CONSTRAINT lead_score_featureset_version_uq UNIQUE (feature_set_id, scoring_version_id)
);

CREATE INDEX lead_score_prospect_idx ON lead_score (prospect_id, calculated_at DESC);

CREATE TABLE score_component (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  lead_score_id uuid NOT NULL REFERENCES lead_score (id),
  dimension text NOT NULL
    CONSTRAINT score_component_dimension_check
    CHECK (dimension IN ('need', 'value', 'activity', 'reachability', 'overall', 'rule')),
  component_key text NOT NULL,
  result numeric,
  direction text
    CONSTRAINT score_component_direction_check
    CHECK (direction IS NULL OR direction IN ('positive', 'negative', 'neutral')),
  reason_code text NOT NULL,
  contributing_features jsonb
);

CREATE INDEX score_component_score_idx ON score_component (lead_score_id);

-- Decisions ------------------------------------------------------------------

CREATE TABLE decision (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  decision_type text NOT NULL
    CONSTRAINT decision_type_check CHECK (decision_type IN (
      'qualify', 'reject', 'generate_demo', 'skip_demo', 'send_outreach',
      'suppress_outreach', 'allow_paid_ai', 'deny_paid_ai', 'escalate',
      'continue_automation', 'merge_business', 'other'
    )),
  result_code text NOT NULL,
  result_detail jsonb,
  business_id uuid REFERENCES business (id),
  prospect_id uuid REFERENCES prospect (id),
  action_ref text,
  feature_set_id uuid REFERENCES feature_set (id),
  lead_score_id uuid REFERENCES lead_score (id),
  policy_version text NOT NULL,
  actor_type actor_type NOT NULL,
  actor_ref text,
  model_provider text,
  model_name text,
  model_version text,
  prompt_version text,
  confidence confidence_band,
  correlation_id uuid,
  run_id uuid,
  job_id uuid,
  decided_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX decision_prospect_idx ON decision (prospect_id, decided_at DESC);
CREATE INDEX decision_type_idx ON decision (decision_type, decided_at DESC);
CREATE INDEX decision_correlation_idx ON decision (correlation_id);

CREATE TABLE decision_reason (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  decision_id uuid NOT NULL REFERENCES decision (id),
  reason_code text NOT NULL,
  feature_ref text,
  evidence_kind text,
  evidence_id uuid,
  contribution text
    CONSTRAINT decision_reason_contribution_check
    CHECK (contribution IS NULL OR contribution IN ('supports', 'opposes', 'neutral')),
  explanation text
);

CREATE INDEX decision_reason_decision_idx ON decision_reason (decision_id);

-- Lifecycle transitions ------------------------------------------------------

-- Invariant 9: prospect lifecycle changes occur only through an allowed,
-- recorded transition against the expected prior revision. The domain service
-- owns the allowed-transition map; this table is the append-only record.
CREATE TABLE prospect_state_transition (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  prospect_id uuid NOT NULL REFERENCES prospect (id),
  from_state prospect_lifecycle_state,
  to_state prospect_lifecycle_state NOT NULL,
  prior_revision integer NOT NULL,
  trigger_kind text,
  decision_id uuid REFERENCES decision (id),
  reason_code text NOT NULL,
  reason_note text,
  actor_type actor_type NOT NULL,
  actor_ref text,
  correlation_id uuid,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX prospect_state_transition_prospect_idx ON prospect_state_transition (prospect_id, occurred_at);

-- Down Migration

DROP TABLE prospect_state_transition;
DROP TABLE decision_reason;
DROP TABLE decision;
DROP TABLE score_component;
DROP TABLE lead_score;
DROP TABLE scoring_version;
DROP TABLE feature_set_lineage;
DROP TABLE feature_set_value;
DROP TABLE feature_set;
DROP TABLE feature_definition;
DROP TABLE prospect;
