-- Up Migration

-- Phase 10: operator review/approval of demo versions, automated QA results,
-- durable asset publication, hosted demo publication state, and bounded local
-- operator runs.
--
-- Core product invariant introduced here: ONLY AN APPROVED DemoVersion may
-- later be used for outreach. Generation, QA success, and "latest" are all
-- explicitly insufficient. Approval is an operator decision that pins one
-- exact DemoVersion and never moves on its own.

-- Decisions ------------------------------------------------------------------

-- Demo review is a first-class decision (ADR-004), not a boolean column.
ALTER TABLE decision DROP CONSTRAINT decision_type_check;
ALTER TABLE decision ADD CONSTRAINT decision_type_check CHECK (decision_type IN (
  'qualify', 'reject', 'generate_demo', 'skip_demo', 'approve_demo', 'reject_demo',
  'send_outreach', 'suppress_outreach', 'allow_paid_ai', 'deny_paid_ai', 'escalate',
  'continue_automation', 'merge_business', 'other'
));

-- Demo QA --------------------------------------------------------------------

-- Append-only automated QA evidence for one exact DemoVersion. Re-running QA
-- records a new result; an older result is never rewritten.
CREATE TABLE demo_version_qa_result (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  demo_version_id uuid NOT NULL REFERENCES demo_version (id),
  runner_version text NOT NULL,
  status text NOT NULL
    CONSTRAINT demo_version_qa_result_status_check
    CHECK (status IN ('passed', 'failed', 'error')),
  checks_total integer NOT NULL DEFAULT 0
    CONSTRAINT demo_version_qa_result_total_check CHECK (checks_total >= 0),
  checks_passed integer NOT NULL DEFAULT 0
    CONSTRAINT demo_version_qa_result_passed_check CHECK (checks_passed >= 0),
  -- Critical failures block approval unless an operator records an audited
  -- override (demo_version_review.qa_override).
  critical_failure_count integer NOT NULL DEFAULT 0
    CONSTRAINT demo_version_qa_result_critical_check CHECK (critical_failure_count >= 0),
  critical_failures jsonb,
  summary jsonb,
  artifact_ref text,
  failure_message text,
  started_at timestamptz,
  completed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT demo_version_qa_result_counts_check CHECK (checks_passed <= checks_total)
);

CREATE INDEX demo_version_qa_result_version_idx
  ON demo_version_qa_result (demo_version_id, completed_at DESC);

-- Demo review / approval ------------------------------------------------------

-- Append-only operator review history: which exact version was approved or
-- rejected, by whom, when, why, and what was approved before it.
CREATE TABLE demo_version_review (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  demo_id uuid NOT NULL REFERENCES demo (id),
  demo_version_id uuid NOT NULL REFERENCES demo_version (id),
  action text NOT NULL
    CONSTRAINT demo_version_review_action_check CHECK (action IN ('approved', 'rejected')),
  previous_approved_demo_version_id uuid REFERENCES demo_version (id),
  decision_id uuid REFERENCES decision (id),
  qa_result_id uuid REFERENCES demo_version_qa_result (id),
  qa_override boolean NOT NULL DEFAULT false,
  actor_type actor_type NOT NULL,
  actor_ref text NOT NULL,
  reason_code text NOT NULL,
  note text,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- An override of failing/absent QA must always carry a written reason.
  CONSTRAINT demo_version_review_override_check
    CHECK (qa_override = false OR note IS NOT NULL)
);

CREATE INDEX demo_version_review_demo_idx ON demo_version_review (demo_id, created_at DESC);
CREATE INDEX demo_version_review_version_idx ON demo_version_review (demo_version_id);

-- The approved pointer is the authoritative "which version may be used"
-- answer; demo_version_review is its audit history. Regeneration never moves
-- this pointer — only an explicit operator approval does.
ALTER TABLE demo
  ADD COLUMN approved_demo_version_id uuid REFERENCES demo_version (id),
  ADD COLUMN approved_at timestamptz,
  ADD COLUMN approved_by_actor_ref text,
  ADD COLUMN approval_review_id uuid REFERENCES demo_version_review (id);

ALTER TABLE demo
  ADD CONSTRAINT demo_approval_consistency_check
  CHECK (num_nonnulls(approved_demo_version_id, approved_at, approved_by_actor_ref) IN (0, 3));

CREATE INDEX demo_approved_version_idx ON demo (approved_demo_version_id)
  WHERE approved_demo_version_id IS NOT NULL;

-- Demo assets ----------------------------------------------------------------

-- Durable, publishable artifacts (brand logo/photography) referenced by a
-- rendered demo. PostgreSQL stores metadata, hashes, and storage references
-- only; bytes live in the artifact store (local .data or Cloudflare R2).
CREATE TABLE demo_asset (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  demo_id uuid NOT NULL REFERENCES demo (id),
  asset_ref text NOT NULL,
  file_name text NOT NULL,
  content_type text NOT NULL,
  byte_size bigint NOT NULL
    CONSTRAINT demo_asset_size_check CHECK (byte_size > 0),
  content_hash text NOT NULL,
  storage_provider text NOT NULL,
  storage_key text NOT NULL,
  first_used_by_demo_version_id uuid REFERENCES demo_version (id),
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT demo_asset_uq UNIQUE (demo_id, asset_ref, file_name)
);

-- Hosted asset resolution looks assets up by their public (ref, file) pair.
CREATE INDEX demo_asset_public_idx ON demo_asset (asset_ref, file_name)
  WHERE published_at IS NOT NULL;

-- Demo publication -----------------------------------------------------------

-- One attempt to make an exact approved DemoVersion available in an
-- environment. Publication never changes the locator and never approves.
CREATE TABLE demo_publication (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  demo_id uuid NOT NULL REFERENCES demo (id),
  demo_version_id uuid NOT NULL REFERENCES demo_version (id),
  environment text NOT NULL
    CONSTRAINT demo_publication_environment_check CHECK (environment IN ('local', 'hosted')),
  status text NOT NULL
    CONSTRAINT demo_publication_status_check
    CHECK (status IN ('publishing', 'published', 'failed', 'superseded')),
  public_url text,
  asset_count integer NOT NULL DEFAULT 0
    CONSTRAINT demo_publication_asset_count_check CHECK (asset_count >= 0),
  detail jsonb,
  failure_message text,
  actor_type actor_type NOT NULL,
  actor_ref text,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT demo_publication_published_check
    CHECK (status <> 'published' OR (public_url IS NOT NULL AND completed_at IS NOT NULL))
);

CREATE INDEX demo_publication_demo_idx ON demo_publication (demo_id, started_at DESC);

-- Only one live publication per demo and environment; older ones become
-- 'superseded' history when a newly approved version is published.
CREATE UNIQUE INDEX demo_publication_live_uq
  ON demo_publication (demo_id, environment)
  WHERE status IN ('publishing', 'published');

-- Operator runs --------------------------------------------------------------

-- Bounded local operator work started from the admin instead of PowerShell.
-- Long analysis never runs inside an HTTP request: the admin enqueues a run
-- and a local worker process executes it and reports progress here.
CREATE TABLE operator_run (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  run_kind text NOT NULL
    CONSTRAINT operator_run_kind_check CHECK (run_kind IN (
      'acquisition', 'demo_generate', 'demo_qa', 'demo_publish', 'retry_intelligence'
    )),
  status text NOT NULL DEFAULT 'queued'
    CONSTRAINT operator_run_status_check CHECK (status IN (
      'queued', 'running', 'completed', 'completed_with_target_failures', 'failed', 'cancelled'
    )),
  requested_parameters jsonb NOT NULL,
  request_key text,
  progress jsonb,
  summary jsonb,
  failure_message text,
  business_id uuid REFERENCES business (id),
  prospect_id uuid REFERENCES prospect (id),
  demo_id uuid REFERENCES demo (id),
  actor_type actor_type NOT NULL,
  actor_ref text NOT NULL,
  correlation_id uuid,
  requested_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  revision integer NOT NULL DEFAULT 1
    CONSTRAINT operator_run_revision_check CHECK (revision > 0),
  CONSTRAINT operator_run_terminal_check
    CHECK (completed_at IS NULL OR status IN ('completed', 'completed_with_target_failures', 'failed', 'cancelled'))
);

CREATE INDEX operator_run_status_idx ON operator_run (status, requested_at DESC);
CREATE INDEX operator_run_kind_idx ON operator_run (run_kind, requested_at DESC);
CREATE INDEX operator_run_prospect_idx ON operator_run (prospect_id, requested_at DESC);

-- Repeated submission of the same operator request does not start a second
-- concurrent run.
CREATE UNIQUE INDEX operator_run_active_request_uq
  ON operator_run (request_key)
  WHERE request_key IS NOT NULL AND status IN ('queued', 'running');

-- Per-target progress and isolated target failures (Phase 6/7 semantics: a
-- target failure is not a failed run).
CREATE TABLE operator_run_target (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  operator_run_id uuid NOT NULL REFERENCES operator_run (id),
  position integer NOT NULL
    CONSTRAINT operator_run_target_position_check CHECK (position > 0),
  label text NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CONSTRAINT operator_run_target_status_check CHECK (status IN (
      'pending', 'running', 'completed', 'target_failed', 'failed', 'skipped'
    )),
  stage text,
  business_id uuid REFERENCES business (id),
  prospect_id uuid REFERENCES prospect (id),
  outcome jsonb,
  failure_kind text,
  failure_code text,
  failure_message text,
  transient boolean,
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT operator_run_target_uq UNIQUE (operator_run_id, position)
);

CREATE INDEX operator_run_target_run_idx ON operator_run_target (operator_run_id, position);

-- Event registry -------------------------------------------------------------

INSERT INTO event_type (name, category, description) VALUES
  ('demo_generated', 'domain', 'A demo version was generated and is awaiting operator review.'),
  ('demo_regenerated', 'domain', 'A new demo version was generated for an existing demo; approval did not move.'),
  ('demo_qa_passed', 'audit', 'Automated demo QA passed for a demo version.'),
  ('demo_qa_failed', 'audit', 'Automated demo QA failed for a demo version.'),
  ('demo_approved', 'domain', 'An operator approved one exact demo version for use.'),
  ('demo_rejected', 'domain', 'An operator rejected a demo version.'),
  ('acquisition_run_started', 'audit', 'An operator started a bounded acquisition run.'),
  ('acquisition_run_completed', 'audit', 'A bounded acquisition run reached a terminal state.'),
  ('retry_requested', 'audit', 'An operator requested a bounded retry of a transient failure.');

-- Down Migration

DELETE FROM event_type WHERE name IN (
  'demo_generated', 'demo_regenerated', 'demo_qa_passed', 'demo_qa_failed',
  'demo_approved', 'demo_rejected', 'acquisition_run_started',
  'acquisition_run_completed', 'retry_requested'
);

DROP TABLE operator_run_target;
DROP TABLE operator_run;
DROP TABLE demo_publication;
DROP TABLE demo_asset;

ALTER TABLE demo
  DROP CONSTRAINT demo_approval_consistency_check,
  DROP COLUMN approval_review_id,
  DROP COLUMN approved_by_actor_ref,
  DROP COLUMN approved_at,
  DROP COLUMN approved_demo_version_id;

DROP TABLE demo_version_review;
DROP TABLE demo_version_qa_result;

ALTER TABLE decision DROP CONSTRAINT decision_type_check;
ALTER TABLE decision ADD CONSTRAINT decision_type_check CHECK (decision_type IN (
  'qualify', 'reject', 'generate_demo', 'skip_demo', 'send_outreach',
  'suppress_outreach', 'allow_paid_ai', 'deny_paid_ai', 'escalate',
  'continue_automation', 'merge_business', 'other'
));
