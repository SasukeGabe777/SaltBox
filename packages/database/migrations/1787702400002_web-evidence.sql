-- Up Migration

-- ADR-004 physical schema, part 2 of 5: domains, websites, immutable
-- point-in-time captures, and versioned analyses.

CREATE TABLE domain (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  host text NOT NULL UNIQUE,
  registrable_domain text,
  status text NOT NULL DEFAULT 'unknown'
    CONSTRAINT domain_status_check CHECK (status IN ('unknown', 'active', 'inactive', 'available')),
  redirect_to_domain_id uuid REFERENCES domain (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  revision integer NOT NULL DEFAULT 1
    CONSTRAINT domain_revision_check CHECK (revision > 0)
);

CREATE INDEX domain_registrable_idx ON domain (registrable_domain);

CREATE TABLE website (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  canonical_url text,
  status text NOT NULL DEFAULT 'unknown'
    CONSTRAINT website_status_check CHECK (status IN ('unknown', 'live', 'offline', 'parked')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  revision integer NOT NULL DEFAULT 1
    CONSTRAINT website_revision_check CHECK (revision > 0)
);

CREATE TABLE website_domain (
  website_id uuid NOT NULL REFERENCES website (id),
  domain_id uuid NOT NULL REFERENCES domain (id),
  relationship text NOT NULL DEFAULT 'canonical'
    CONSTRAINT website_domain_relationship_check
    CHECK (relationship IN ('canonical', 'redirect', 'alias')),
  is_primary boolean NOT NULL DEFAULT false,
  valid_from timestamptz,
  valid_to timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (website_id, domain_id)
);

CREATE UNIQUE INDEX website_domain_single_primary_uq ON website_domain (website_id) WHERE is_primary;

-- Business ↔ website is many-to-many (shared brands, franchise pages,
-- redirects), with at most one primary website per business.
CREATE TABLE business_website (
  business_id uuid NOT NULL REFERENCES business (id),
  website_id uuid NOT NULL REFERENCES website (id),
  relationship text NOT NULL DEFAULT 'owned'
    CONSTRAINT business_website_relationship_check
    CHECK (relationship IN ('owned', 'shared', 'franchise', 'redirect', 'unverified')),
  is_primary boolean NOT NULL DEFAULT false,
  valid_from timestamptz,
  valid_to timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (business_id, website_id)
);

CREATE UNIQUE INDEX business_website_single_primary_uq ON business_website (business_id) WHERE is_primary;
CREATE INDEX business_website_website_idx ON business_website (website_id);

-- Immutable capture manifest for a website at a time.
CREATE TABLE website_snapshot (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  website_id uuid NOT NULL REFERENCES website (id),
  requested_url text NOT NULL,
  final_url text,
  crawl_scope text NOT NULL DEFAULT 'single_page',
  http_status integer,
  https_ok boolean,
  redirect_chain jsonb,
  content_ref text,
  content_hash text,
  observed_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  capture_tool_version text NOT NULL
);

CREATE INDEX website_snapshot_website_idx ON website_snapshot (website_id, observed_at DESC);

-- Versioned result derived from one or more snapshots; reanalysis appends a
-- new row without pretending the website itself changed.
CREATE TABLE website_analysis (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  website_id uuid NOT NULL REFERENCES website (id),
  analyzer_version text NOT NULL,
  findings_schema_version integer NOT NULL DEFAULT 1,
  structured_findings jsonb NOT NULL,
  confidence confidence_band NOT NULL DEFAULT 'unknown',
  validation_status text NOT NULL DEFAULT 'unvalidated'
    CONSTRAINT website_analysis_validation_check
    CHECK (validation_status IN ('unvalidated', 'valid', 'invalid')),
  calculated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX website_analysis_website_idx ON website_analysis (website_id, calculated_at DESC);

CREATE TABLE website_analysis_snapshot (
  website_analysis_id uuid NOT NULL REFERENCES website_analysis (id),
  website_snapshot_id uuid NOT NULL REFERENCES website_snapshot (id),
  PRIMARY KEY (website_analysis_id, website_snapshot_id)
);

-- Down Migration

DROP TABLE website_analysis_snapshot;
DROP TABLE website_analysis;
DROP TABLE website_snapshot;
DROP TABLE business_website;
DROP TABLE website_domain;
DROP TABLE website;
DROP TABLE domain;
