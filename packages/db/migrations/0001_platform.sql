-- HomeFAX platform schema.
--
-- One database, seven schemas, each a boundary:
--   auth       who you are (identity), separated from how you prove it (credentials, sessions)
--   people     what you choose to show (profile) — never mixed with auth
--   org        companies and institutions, membership, jurisdiction
--   property   the house itself, its owners, its running stats, its timeline, its documents
--   build      the construction record: captures, grades, the ledger, findings, materials
--   access     who outside the project may see a property, how, and the log of every look
--   oversight  lenders, insurers, municipalities, brokerages and their relationships to houses
--   audit      append-only change log
--
-- Every table is protected by row-level security, FORCED so it applies to the
-- table owner too. The application sets three transaction-local settings:
--   app.actor_id    the signed-in identity id ('' when anonymous)
--   app.role        'service' for trusted server-side jobs (login, pipeline, import)
--   app.share_hash  SHA-256 of a share-link token, for public report reads
-- Policies only ever read those through the app.* helper functions below.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE SCHEMA IF NOT EXISTS app;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS people;
CREATE SCHEMA IF NOT EXISTS org;
CREATE SCHEMA IF NOT EXISTS property;
CREATE SCHEMA IF NOT EXISTS build;
CREATE SCHEMA IF NOT EXISTS access;
CREATE SCHEMA IF NOT EXISTS oversight;
CREATE SCHEMA IF NOT EXISTS audit;

-- The least-privilege runtime role. Created NOLOGIN here; scripts/create-app-role
-- gives it a password. With only the owner connection available, FORCE RLS still
-- makes every policy below bind.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'homefax_app') THEN
    CREATE ROLE homefax_app NOLOGIN NOINHERIT NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END $$;

/* ============================== helpers ================================= */

CREATE OR REPLACE FUNCTION app.actor_id() RETURNS text
LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.actor_id', true), '') $$;

CREATE OR REPLACE FUNCTION app.is_service() RETURNS boolean
LANGUAGE sql STABLE AS $$ SELECT coalesce(current_setting('app.role', true), '') = 'service' $$;

CREATE OR REPLACE FUNCTION app.share_hash() RETURNS text
LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.share_hash', true), '') $$;

CREATE OR REPLACE FUNCTION app.touch_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

/* ================================ auth ================================== */

CREATE TABLE auth.identities (
  id            text PRIMARY KEY,
  email         text NOT NULL,
  email_verified_at timestamptz,
  status        text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','deleted')),
  last_sign_in_at timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz,
  CONSTRAINT identities_email_lower CHECK (email = lower(btrim(email)))
);
CREATE UNIQUE INDEX identities_email_idx ON auth.identities (email);
CREATE TRIGGER identities_touch BEFORE UPDATE ON auth.identities FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

-- Secrets live apart from the identity row so a read of identities never yields a hash.
CREATE TABLE auth.credentials (
  identity_id   text PRIMARY KEY REFERENCES auth.identities(id) ON DELETE CASCADE,
  password_hash text NOT NULL,
  must_change   boolean NOT NULL DEFAULT false,
  rotated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE auth.sessions (
  id            text PRIMARY KEY,
  token_hash    text NOT NULL,
  identity_id   text NOT NULL REFERENCES auth.identities(id) ON DELETE CASCADE,
  app           text NOT NULL CHECK (app IN ('contractor','homeowner','admin')),
  ip            inet,
  user_agent    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  revoked_at    timestamptz
);
CREATE UNIQUE INDEX sessions_token_hash_idx ON auth.sessions (token_hash);
CREATE INDEX sessions_identity_idx ON auth.sessions (identity_id) WHERE revoked_at IS NULL;

CREATE TABLE auth.login_attempts (
  id            bigserial PRIMARY KEY,
  email         text NOT NULL,
  ip            inet,
  succeeded     boolean NOT NULL,
  app           text NOT NULL,
  at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX login_attempts_email_at_idx ON auth.login_attempts (email, at DESC);
CREATE INDEX login_attempts_ip_at_idx ON auth.login_attempts (ip, at DESC);

CREATE TABLE auth.password_resets (
  id            text PRIMARY KEY,
  identity_id   text NOT NULL REFERENCES auth.identities(id) ON DELETE CASCADE,
  token_hash    text NOT NULL,
  issued_by     text REFERENCES auth.identities(id) ON DELETE SET NULL,
  expires_at    timestamptz NOT NULL,
  used_at       timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX password_resets_token_idx ON auth.password_resets (token_hash);
CREATE INDEX password_resets_identity_idx ON auth.password_resets (identity_id);

/* =============================== people ================================= */

CREATE TABLE people.profiles (
  identity_id   text PRIMARY KEY REFERENCES auth.identities(id) ON DELETE CASCADE,
  name          text NOT NULL,
  handle        text NOT NULL CHECK (handle ~ '^[a-z0-9-]{3,24}$'),
  headline      text,
  bio           text,
  avatar_url    text,
  -- AES-256-GCM, see @homefax/auth encryptField. Never stored in clear.
  phone_enc     text,
  is_public     boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX profiles_handle_idx ON people.profiles (handle);
CREATE TRIGGER profiles_touch BEFORE UPDATE ON people.profiles FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

/* ================================= org ================================== */

CREATE TABLE org.organizations (
  id            text PRIMARY KEY,
  kind          text NOT NULL CHECK (kind IN ('contractor','lender','insurer','municipality','brokerage','inspector')),
  name          text NOT NULL,
  slug          text NOT NULL CHECK (slug ~ '^[a-z0-9-]{1,64}$'),
  headline      text,
  bio           text,
  is_public     boolean NOT NULL DEFAULT false,
  -- The company's HomeFAX key (hfx_…). Quoted to be added to someone's project.
  hfx_key       text NOT NULL,
  owner_identity_id text NOT NULL REFERENCES auth.identities(id),
  legacy_key_id text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX organizations_slug_idx ON org.organizations (slug);
CREATE UNIQUE INDEX organizations_hfx_key_idx ON org.organizations (hfx_key);
CREATE INDEX organizations_kind_idx ON org.organizations (kind);
CREATE TRIGGER organizations_touch BEFORE UPDATE ON org.organizations FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

CREATE TABLE org.memberships (
  id            text PRIMARY KEY,
  org_id        text NOT NULL REFERENCES org.organizations(id) ON DELETE CASCADE,
  identity_id   text NOT NULL REFERENCES auth.identities(id) ON DELETE CASCADE,
  role          text NOT NULL DEFAULT 'member' CHECK (role IN ('owner','admin','member')),
  title         text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX memberships_org_identity_idx ON org.memberships (org_id, identity_id);
CREATE INDEX memberships_identity_idx ON org.memberships (identity_id);

-- Invitations to join an organisation, by link. Only the hash is kept.
CREATE TABLE org.invitations (
  id            text PRIMARY KEY,
  org_id        text NOT NULL REFERENCES org.organizations(id) ON DELETE CASCADE,
  email         text,
  role          text NOT NULL DEFAULT 'member' CHECK (role IN ('admin','member')),
  title         text,
  token_hash    text NOT NULL,
  invited_by    text REFERENCES auth.identities(id) ON DELETE SET NULL,
  expires_at    timestamptz NOT NULL,
  accepted_by   text REFERENCES auth.identities(id) ON DELETE SET NULL,
  accepted_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX invitations_token_idx ON org.invitations (token_hash);
CREATE INDEX invitations_org_idx ON org.invitations (org_id);

-- A municipality's territory. A property is in it when state matches and any
-- one of city / county / postal code matches (null = wildcard for that part).
CREATE TABLE org.jurisdictions (
  id            text PRIMARY KEY,
  org_id        text NOT NULL REFERENCES org.organizations(id) ON DELETE CASCADE,
  state         text NOT NULL CHECK (state = upper(state) AND length(state) = 2),
  city          text,
  county        text,
  postal_code   text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT jurisdictions_some_part CHECK (city IS NOT NULL OR county IS NOT NULL OR postal_code IS NOT NULL)
);
CREATE INDEX jurisdictions_state_city_idx ON org.jurisdictions (state, upper(city));
CREATE INDEX jurisdictions_org_idx ON org.jurisdictions (org_id);

/* =============================== property =============================== */

CREATE TABLE property.properties (
  id            text PRIMARY KEY,
  slug          text NOT NULL CHECK (slug ~ '^[a-z0-9-]{1,80}$'),
  line1         text NOT NULL,
  line2         text,
  city          text NOT NULL,
  state         text NOT NULL CHECK (state = upper(state) AND length(state) = 2),
  postal_code   text NOT NULL,
  county        text,
  country       text NOT NULL DEFAULT 'US',
  -- Dedup key: one row per physical address regardless of how it was typed.
  address_key   text GENERATED ALWAYS AS (
                  lower(regexp_replace(line1 || coalesce(line2,'') || city || state || postal_code, '[^A-Za-z0-9]', '', 'g'))
                ) STORED,
  parcel_id     text,
  lat           double precision,
  lng           double precision,
  kind          text NOT NULL DEFAULT 'single_family' CHECK (kind IN ('single_family','multi_family','condo','townhome','commercial','other')),
  year_built    integer CHECK (year_built IS NULL OR year_built BETWEEN 1600 AND 2100),
  floor_area_sqft integer CHECK (floor_area_sqft IS NULL OR floor_area_sqft > 0),
  lot_area_sqft integer,
  bedrooms      integer,
  bathrooms     numeric(3,1),
  created_by    text REFERENCES auth.identities(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX properties_slug_idx ON property.properties (slug);
CREATE UNIQUE INDEX properties_address_key_idx ON property.properties (address_key);
CREATE INDEX properties_state_city_idx ON property.properties (state, upper(city));
CREATE INDEX properties_postal_idx ON property.properties (postal_code);
CREATE TRIGGER properties_touch BEFORE UPDATE ON property.properties FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

-- Who owns (or owned) the house. Ownership has a period; the record outlives any owner.
CREATE TABLE property.property_owners (
  id            text PRIMARY KEY,
  property_id   text NOT NULL REFERENCES property.properties(id) ON DELETE CASCADE,
  identity_id   text NOT NULL REFERENCES auth.identities(id) ON DELETE CASCADE,
  role          text NOT NULL DEFAULT 'owner' CHECK (role IN ('owner','co_owner','tenant')),
  claimed_via   text NOT NULL CHECK (claimed_via IN ('invite','contractor','transfer','import','seed')),
  since         timestamptz NOT NULL DEFAULT now(),
  until         timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT property_owners_period CHECK (until IS NULL OR until > since)
);
CREATE INDEX property_owners_property_idx ON property.property_owners (property_id) WHERE until IS NULL;
CREATE INDEX property_owners_identity_idx ON property.property_owners (identity_id) WHERE until IS NULL;

-- The contractor hands the house over with a claim code. One use, short life.
CREATE TABLE property.owner_invites (
  id            text PRIMARY KEY,
  property_id   text NOT NULL REFERENCES property.properties(id) ON DELETE CASCADE,
  code_hash     text NOT NULL,
  email         text,
  invited_by    text REFERENCES auth.identities(id) ON DELETE SET NULL,
  expires_at    timestamptz NOT NULL,
  claimed_by    text REFERENCES auth.identities(id) ON DELETE SET NULL,
  claimed_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX owner_invites_code_idx ON property.owner_invites (code_hash);
CREATE INDEX owner_invites_property_idx ON property.owner_invites (property_id);

-- Running numbers about the house. Maintained by property.recompute_stats();
-- never written by hand. One row per property, created with the property.
CREATE TABLE property.property_stats (
  property_id       text PRIMARY KEY REFERENCES property.properties(id) ON DELETE CASCADE,
  stages_total      integer NOT NULL DEFAULT 11,
  stages_filmed     integer NOT NULL DEFAULT 0,
  stages_in_flight  integer NOT NULL DEFAULT 0,
  points_passed     integer NOT NULL DEFAULT 0,
  points_assessed   integer NOT NULL DEFAULT 0,
  points_failed     integer NOT NULL DEFAULT 0,
  open_safety_items integer NOT NULL DEFAULT 0,
  open_moisture_items integer NOT NULL DEFAULT 0,
  critical_findings integer NOT NULL DEFAULT 0,
  major_findings    integer NOT NULL DEFAULT 0,
  latest_score      real CHECK (latest_score IS NULL OR latest_score BETWEEN 0 AND 100),
  latest_grade      text CHECK (latest_grade IS NULL OR latest_grade IN ('A','B','C','D','F')),
  mean_score        real,
  latest_stage      text,
  materials_lines   integer NOT NULL DEFAULT 0,
  materials_total_cents bigint NOT NULL DEFAULT 0,
  measured_floor_area_m2 real,
  last_capture_at   timestamptz,
  verified_stages   integer NOT NULL DEFAULT 0,
  flagged_stages    integer NOT NULL DEFAULT 0,
  recomputed_at     timestamptz NOT NULL DEFAULT now()
);

-- The house's timeline, as a person would tell it.
CREATE TABLE property.property_events (
  id            text PRIMARY KEY,
  property_id   text NOT NULL REFERENCES property.properties(id) ON DELETE CASCADE,
  kind          text NOT NULL CHECK (kind IN (
                  'record_opened','stage_filmed','stage_graded','stage_failed','owner_claimed','owner_transferred',
                  'access_granted','access_revoked','access_requested','share_link_created','document_added',
                  'permit_issued','inspection_verdict','draw_decided','policy_bound','listing_changed','note')),
  title         text NOT NULL,
  detail        text,
  stage         text,
  actor_id      text REFERENCES auth.identities(id) ON DELETE SET NULL,
  actor_org_id  text REFERENCES org.organizations(id) ON DELETE SET NULL,
  -- 'full' events are the owner's business; 'ledger' events are visible to anyone with ledger scope.
  visibility    text NOT NULL DEFAULT 'full' CHECK (visibility IN ('summary','ledger','full')),
  at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX property_events_property_at_idx ON property.property_events (property_id, at DESC);

CREATE TABLE property.property_documents (
  id            text PRIMARY KEY,
  property_id   text NOT NULL REFERENCES property.properties(id) ON DELETE CASCADE,
  kind          text NOT NULL CHECK (kind IN ('permit','plan','warranty','invoice','inspection','insurance','deed','manual','photo','other')),
  title         text NOT NULL,
  blob_url      text NOT NULL,
  content_type  text,
  size_bytes    bigint,
  uploaded_by   text REFERENCES auth.identities(id) ON DELETE SET NULL,
  uploaded_by_org_id text REFERENCES org.organizations(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX property_documents_property_idx ON property.property_documents (property_id);

/* ================================ build ================================= */

CREATE TABLE build.records (
  id            text PRIMARY KEY,
  slug          text NOT NULL CHECK (slug ~ '^[a-z0-9-]{1,80}$'),
  property_id   text NOT NULL REFERENCES property.properties(id) ON DELETE RESTRICT,
  org_id        text REFERENCES org.organizations(id) ON DELETE SET NULL,
  title         text,
  status        text NOT NULL DEFAULT 'open' CHECK (status IN ('open','complete','archived')),
  owner_name    text,
  contractor_name text,
  legacy_key_id text,
  created_by    text REFERENCES auth.identities(id) ON DELETE SET NULL,
  opened_at     timestamptz NOT NULL DEFAULT now(),
  completed_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX records_slug_idx ON build.records (slug);
CREATE INDEX records_property_idx ON build.records (property_id);
CREATE INDEX records_org_idx ON build.records (org_id);
CREATE TRIGGER records_touch BEFORE UPDATE ON build.records FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

-- The project team: companies with access to a record.
CREATE TABLE build.record_access (
  id            text PRIMARY KEY,
  record_id     text NOT NULL REFERENCES build.records(id) ON DELETE CASCADE,
  org_id        text NOT NULL REFERENCES org.organizations(id) ON DELETE CASCADE,
  role          text NOT NULL DEFAULT 'collaborator' CHECK (role IN ('owner','collaborator')),
  added_by      text REFERENCES auth.identities(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX record_access_record_org_idx ON build.record_access (record_id, org_id);
CREATE INDEX record_access_org_idx ON build.record_access (org_id);

CREATE TABLE build.captures (
  id            text PRIMARY KEY,
  record_id     text NOT NULL REFERENCES build.records(id) ON DELETE CASCADE,
  property_id   text NOT NULL REFERENCES property.properties(id) ON DELETE CASCADE,
  stage         text NOT NULL CHECK (stage IN ('site','foundation','framing','roofing','rough_plumbing','rough_electrical','hvac','insulation','drywall','finishes','final')),
  job_id        text,
  state         text NOT NULL DEFAULT 'queued' CHECK (state IN ('queued','extracting','registering','reconstructing','meshing','analyzing','done','failed')),
  source_url    text,
  frames        jsonb NOT NULL DEFAULT '[]'::jsonb,
  glb_url       text,
  job           jsonb,
  quality       jsonb,
  parts         jsonb NOT NULL DEFAULT '[]'::jsonb,
  score         real CHECK (score IS NULL OR score BETWEEN 0 AND 100),
  notes         text,
  filmed_by     text REFERENCES auth.identities(id) ON DELETE SET NULL,
  filmed_by_org_id text REFERENCES org.organizations(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX captures_record_stage_idx ON build.captures (record_id, stage);
CREATE INDEX captures_property_idx ON build.captures (property_id);
CREATE INDEX captures_state_idx ON build.captures (state) WHERE state NOT IN ('done','failed');
CREATE TRIGGER captures_touch BEFORE UPDATE ON build.captures FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

-- The grade, flattened out of the quality report so a portfolio can be queried.
CREATE TABLE build.stage_grades (
  id            text PRIMARY KEY,
  capture_id    text NOT NULL REFERENCES build.captures(id) ON DELETE CASCADE,
  record_id     text NOT NULL REFERENCES build.records(id) ON DELETE CASCADE,
  property_id   text NOT NULL REFERENCES property.properties(id) ON DELETE CASCADE,
  stage         text NOT NULL,
  score         real NOT NULL CHECK (score BETWEEN 0 AND 100),
  grade         text NOT NULL CHECK (grade IN ('A','B','C','D','F')),
  capture_score real, geometry_score real, workmanship_score real, compliance_score real,
  vision_status text CHECK (vision_status IN ('graded','unavailable','stage_not_shown')),
  checkpoints_passed integer NOT NULL DEFAULT 0,
  checkpoints_assessed integer NOT NULL DEFAULT 0,
  checkpoints_applicable integer NOT NULL DEFAULT 0,
  simulated     boolean NOT NULL DEFAULT false,
  filmed_at     timestamptz NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX stage_grades_capture_idx ON build.stage_grades (capture_id);
CREATE INDEX stage_grades_property_idx ON build.stage_grades (property_id, filmed_at DESC);

CREATE TABLE build.checkpoint_results (
  id            text PRIMARY KEY,
  capture_id    text NOT NULL REFERENCES build.captures(id) ON DELETE CASCADE,
  property_id   text NOT NULL REFERENCES property.properties(id) ON DELETE CASCADE,
  stage         text NOT NULL,
  qc_id         text NOT NULL CHECK (qc_id ~ '^QC-[0-9]{2}$'),
  num           integer NOT NULL CHECK (num BETWEEN 1 AND 50),
  title         text NOT NULL,
  category      text NOT NULL CHECK (category IN ('structure','envelope','mechanical','surfaces','moisture','safety','capture')),
  status        text NOT NULL CHECK (status IN ('pass','attention','fail','not_assessable')),
  source        text NOT NULL CHECK (source IN ('geometry','capture','vision')),
  evidence      text NOT NULL,
  keyframe_index integer
);
CREATE UNIQUE INDEX checkpoint_results_capture_qc_idx ON build.checkpoint_results (capture_id, qc_id);
CREATE INDEX checkpoint_results_property_status_idx ON build.checkpoint_results (property_id, status, category);

CREATE TABLE build.findings (
  id            text PRIMARY KEY,
  capture_id    text NOT NULL REFERENCES build.captures(id) ON DELETE CASCADE,
  property_id   text NOT NULL REFERENCES property.properties(id) ON DELETE CASCADE,
  stage         text NOT NULL,
  severity      text NOT NULL CHECK (severity IN ('info','minor','major','critical')),
  dimension     text NOT NULL CHECK (dimension IN ('capture','geometry','workmanship','compliance')),
  source        text NOT NULL CHECK (source IN ('geometry','vision','capture')),
  title         text NOT NULL,
  detail        text NOT NULL,
  keyframe_index integer,
  resolved_at   timestamptz,
  resolved_by   text REFERENCES auth.identities(id) ON DELETE SET NULL
);
CREATE INDEX findings_property_sev_idx ON build.findings (property_id, severity) WHERE resolved_at IS NULL;
CREATE INDEX findings_capture_idx ON build.findings (capture_id);

CREATE TABLE build.part_lines (
  id            text PRIMARY KEY,
  capture_id    text NOT NULL REFERENCES build.captures(id) ON DELETE CASCADE,
  property_id   text NOT NULL REFERENCES property.properties(id) ON DELETE CASCADE,
  stage         text NOT NULL,
  sku           text NOT NULL,
  name          text NOT NULL,
  category      text NOT NULL,
  spec          text,
  quantity      real NOT NULL CHECK (quantity >= 0),
  unit          text NOT NULL,
  basis         text NOT NULL CHECK (basis IN ('measured','detected','derived')),
  derivation    text NOT NULL,
  confidence    real NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  unit_cost_cents integer,
  identified    jsonb
);
CREATE INDEX part_lines_property_idx ON build.part_lines (property_id, category);
CREATE INDEX part_lines_capture_idx ON build.part_lines (capture_id);

CREATE TABLE build.assignments (
  id            text PRIMARY KEY,
  record_id     text NOT NULL REFERENCES build.records(id) ON DELETE CASCADE,
  assignee_identity_id text REFERENCES auth.identities(id) ON DELETE CASCADE,
  assignee_org_id text REFERENCES org.organizations(id) ON DELETE CASCADE,
  task          text NOT NULL,
  stage         text,
  status        text NOT NULL DEFAULT 'open' CHECK (status IN ('open','done')),
  assigned_by   text REFERENCES auth.identities(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT assignments_one_assignee CHECK ((assignee_identity_id IS NULL) <> (assignee_org_id IS NULL))
);
CREATE INDEX assignments_record_idx ON build.assignments (record_id);
CREATE INDEX assignments_identity_idx ON build.assignments (assignee_identity_id);
CREATE INDEX assignments_org_idx ON build.assignments (assignee_org_id);

CREATE TABLE build.hires (
  id            text PRIMARY KEY,
  from_org_id   text NOT NULL REFERENCES org.organizations(id) ON DELETE CASCADE,
  to_identity_id text REFERENCES auth.identities(id) ON DELETE CASCADE,
  to_org_id     text REFERENCES org.organizations(id) ON DELETE CASCADE,
  task          text NOT NULL,
  record_id     text REFERENCES build.records(id) ON DELETE SET NULL,
  note          text,
  status        text NOT NULL DEFAULT 'offered' CHECK (status IN ('offered','accepted','declined','completed')),
  created_by    text REFERENCES auth.identities(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hires_one_target CHECK ((to_identity_id IS NULL) <> (to_org_id IS NULL))
);
CREATE INDEX hires_from_idx ON build.hires (from_org_id);
CREATE INDEX hires_to_identity_idx ON build.hires (to_identity_id);
CREATE INDEX hires_to_org_idx ON build.hires (to_org_id);

/* ================================ access ================================ */

-- Scope ladder: summary < ledger < full.
--   summary  the address, the stats row, the grades
--   ledger   + the models, the 50-point ledger, the findings
--   full     + materials and costs, documents, the owner's timeline
CREATE OR REPLACE FUNCTION access.scope_rank(scope text) RETURNS integer
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE scope WHEN 'summary' THEN 1 WHEN 'ledger' THEN 2 WHEN 'full' THEN 3 ELSE 0 END
$$;

CREATE TABLE access.grants (
  id            text PRIMARY KEY,
  property_id   text NOT NULL REFERENCES property.properties(id) ON DELETE CASCADE,
  grantee_org_id text REFERENCES org.organizations(id) ON DELETE CASCADE,
  grantee_identity_id text REFERENCES auth.identities(id) ON DELETE CASCADE,
  scope         text NOT NULL CHECK (scope IN ('summary','ledger','full')),
  purpose       text,
  granted_by    text REFERENCES auth.identities(id) ON DELETE SET NULL,
  expires_at    timestamptz,
  revoked_at    timestamptz,
  revoked_by    text REFERENCES auth.identities(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT grants_one_grantee CHECK ((grantee_org_id IS NULL) <> (grantee_identity_id IS NULL))
);
CREATE INDEX grants_property_idx ON access.grants (property_id) WHERE revoked_at IS NULL;
CREATE INDEX grants_org_idx ON access.grants (grantee_org_id) WHERE revoked_at IS NULL;
CREATE INDEX grants_identity_idx ON access.grants (grantee_identity_id) WHERE revoked_at IS NULL;

CREATE TABLE access.access_requests (
  id            text PRIMARY KEY,
  property_id   text NOT NULL REFERENCES property.properties(id) ON DELETE CASCADE,
  requester_org_id text NOT NULL REFERENCES org.organizations(id) ON DELETE CASCADE,
  requester_identity_id text REFERENCES auth.identities(id) ON DELETE SET NULL,
  scope         text NOT NULL CHECK (scope IN ('summary','ledger','full')),
  purpose       text NOT NULL,
  status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','denied','withdrawn')),
  decided_by    text REFERENCES auth.identities(id) ON DELETE SET NULL,
  decided_at    timestamptz,
  grant_id      text REFERENCES access.grants(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX access_requests_property_idx ON access.access_requests (property_id, status);
CREATE INDEX access_requests_org_idx ON access.access_requests (requester_org_id, status);

CREATE TABLE access.share_links (
  id            text PRIMARY KEY,
  property_id   text NOT NULL REFERENCES property.properties(id) ON DELETE CASCADE,
  token_hash    text NOT NULL,
  scope         text NOT NULL CHECK (scope IN ('summary','ledger','full')),
  label         text,
  created_by    text REFERENCES auth.identities(id) ON DELETE SET NULL,
  created_by_org_id text REFERENCES org.organizations(id) ON DELETE SET NULL,
  expires_at    timestamptz,
  revoked_at    timestamptz,
  view_count    integer NOT NULL DEFAULT 0,
  last_viewed_at timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX share_links_token_idx ON access.share_links (token_hash);
CREATE INDEX share_links_property_idx ON access.share_links (property_id);

-- Every look at a property by someone who is not its owner.
CREATE TABLE access.access_log (
  id            bigserial PRIMARY KEY,
  property_id   text NOT NULL REFERENCES property.properties(id) ON DELETE CASCADE,
  viewer_identity_id text REFERENCES auth.identities(id) ON DELETE SET NULL,
  viewer_org_id text REFERENCES org.organizations(id) ON DELETE SET NULL,
  via           text NOT NULL CHECK (via IN ('owner','project','grant','jurisdiction','share_link','service')),
  scope         text NOT NULL,
  app           text NOT NULL,
  path          text,
  share_link_id text REFERENCES access.share_links(id) ON DELETE SET NULL,
  at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX access_log_property_at_idx ON access.access_log (property_id, at DESC);
CREATE INDEX access_log_viewer_org_idx ON access.access_log (viewer_org_id, at DESC);

/* ============================== oversight =============================== */

-- A lender's position in a house.
CREATE TABLE oversight.portfolio_holdings (
  id            text PRIMARY KEY,
  org_id        text NOT NULL REFERENCES org.organizations(id) ON DELETE CASCADE,
  property_id   text NOT NULL REFERENCES property.properties(id) ON DELETE RESTRICT,
  kind          text NOT NULL CHECK (kind IN ('construction','mortgage','heloc','bridge','commercial')),
  loan_ref_enc  text,
  principal_cents bigint NOT NULL CHECK (principal_cents >= 0),
  rate_bps      integer,
  originated_at date,
  matures_at    date,
  status        text NOT NULL DEFAULT 'active' CHECK (status IN ('pipeline','active','paid_off','default','sold')),
  notes         text,
  created_by    text REFERENCES auth.identities(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX portfolio_holdings_org_property_idx ON oversight.portfolio_holdings (org_id, property_id);
CREATE INDEX portfolio_holdings_property_idx ON oversight.portfolio_holdings (property_id);
CREATE TRIGGER portfolio_holdings_touch BEFORE UPDATE ON oversight.portfolio_holdings FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

-- Construction loans fund by stage. A draw is verified against the filmed stage's grade.
CREATE TABLE oversight.loan_draws (
  id            text PRIMARY KEY,
  holding_id    text NOT NULL REFERENCES oversight.portfolio_holdings(id) ON DELETE CASCADE,
  property_id   text NOT NULL REFERENCES property.properties(id) ON DELETE CASCADE,
  stage         text NOT NULL,
  amount_cents  bigint NOT NULL CHECK (amount_cents > 0),
  status        text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','verified','released','held','rejected')),
  basis_capture_id text REFERENCES build.captures(id) ON DELETE SET NULL,
  recommendation text,
  requested_by  text REFERENCES auth.identities(id) ON DELETE SET NULL,
  requested_at  timestamptz NOT NULL DEFAULT now(),
  decided_by    text REFERENCES auth.identities(id) ON DELETE SET NULL,
  decided_at    timestamptz,
  decision_note text
);
CREATE INDEX loan_draws_holding_idx ON oversight.loan_draws (holding_id);
CREATE INDEX loan_draws_property_idx ON oversight.loan_draws (property_id, status);

CREATE TABLE oversight.policies (
  id            text PRIMARY KEY,
  org_id        text NOT NULL REFERENCES org.organizations(id) ON DELETE CASCADE,
  property_id   text NOT NULL REFERENCES property.properties(id) ON DELETE RESTRICT,
  kind          text NOT NULL CHECK (kind IN ('homeowners','builders_risk','flood','umbrella','commercial')),
  policy_ref_enc text,
  coverage_cents bigint NOT NULL CHECK (coverage_cents >= 0),
  premium_cents bigint,
  effective_from date NOT NULL,
  effective_to  date NOT NULL,
  status        text NOT NULL DEFAULT 'quoted' CHECK (status IN ('quoted','bound','active','lapsed','cancelled')),
  notes         text,
  created_by    text REFERENCES auth.identities(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT policies_period CHECK (effective_to > effective_from)
);
CREATE INDEX policies_org_idx ON oversight.policies (org_id, status);
CREATE INDEX policies_property_idx ON oversight.policies (property_id);
CREATE TRIGGER policies_touch BEFORE UPDATE ON oversight.policies FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

CREATE TABLE oversight.listings (
  id            text PRIMARY KEY,
  org_id        text NOT NULL REFERENCES org.organizations(id) ON DELETE CASCADE,
  property_id   text NOT NULL REFERENCES property.properties(id) ON DELETE RESTRICT,
  agent_identity_id text REFERENCES auth.identities(id) ON DELETE SET NULL,
  list_price_cents bigint CHECK (list_price_cents IS NULL OR list_price_cents >= 0),
  status        text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','pending','sold','withdrawn')),
  mls_ref       text,
  share_link_id text REFERENCES access.share_links(id) ON DELETE SET NULL,
  listed_at     date,
  closed_at     date,
  sold_price_cents bigint,
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX listings_org_idx ON oversight.listings (org_id, status);
CREATE INDEX listings_property_idx ON oversight.listings (property_id);
CREATE TRIGGER listings_touch BEFORE UPDATE ON oversight.listings FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

CREATE TABLE oversight.permits (
  id            text PRIMARY KEY,
  property_id   text NOT NULL REFERENCES property.properties(id) ON DELETE RESTRICT,
  municipality_org_id text NOT NULL REFERENCES org.organizations(id) ON DELETE CASCADE,
  record_id     text REFERENCES build.records(id) ON DELETE SET NULL,
  permit_no     text NOT NULL,
  kind          text NOT NULL CHECK (kind IN ('building','electrical','plumbing','mechanical','roofing','demolition','other')),
  status        text NOT NULL DEFAULT 'applied' CHECK (status IN ('applied','issued','inspected','closed','flagged','revoked')),
  applied_at    date,
  issued_at     date,
  closed_at     date,
  notes         text,
  created_by    text REFERENCES auth.identities(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX permits_muni_no_idx ON oversight.permits (municipality_org_id, permit_no);
CREATE INDEX permits_property_idx ON oversight.permits (property_id);
CREATE TRIGGER permits_touch BEFORE UPDATE ON oversight.permits FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

-- A city official's verdict on a filmed stage.
CREATE TABLE oversight.inspection_reviews (
  id            text PRIMARY KEY,
  capture_id    text NOT NULL REFERENCES build.captures(id) ON DELETE CASCADE,
  property_id   text NOT NULL REFERENCES property.properties(id) ON DELETE CASCADE,
  municipality_org_id text NOT NULL REFERENCES org.organizations(id) ON DELETE CASCADE,
  permit_id     text REFERENCES oversight.permits(id) ON DELETE SET NULL,
  reviewer_id   text REFERENCES auth.identities(id) ON DELETE SET NULL,
  verdict       text NOT NULL CHECK (verdict IN ('verified','flagged','site_visit')),
  notes         text,
  at            timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX inspection_reviews_capture_muni_idx ON oversight.inspection_reviews (capture_id, municipality_org_id);
CREATE INDEX inspection_reviews_property_idx ON oversight.inspection_reviews (property_id);

/* ================================ audit ================================= */

CREATE TABLE audit.audit_log (
  id            bigserial PRIMARY KEY,
  at            timestamptz NOT NULL DEFAULT now(),
  actor_id      text,
  is_service    boolean NOT NULL DEFAULT false,
  action        text NOT NULL CHECK (action IN ('INSERT','UPDATE','DELETE')),
  schema_name   text NOT NULL,
  table_name    text NOT NULL,
  row_id        text,
  property_id   text,
  org_id        text,
  before        jsonb,
  after         jsonb
);
CREATE INDEX audit_log_table_row_idx ON audit.audit_log (schema_name, table_name, row_id);
CREATE INDEX audit_log_property_idx ON audit.audit_log (property_id, at DESC);
CREATE INDEX audit_log_org_idx ON audit.audit_log (org_id, at DESC);
CREATE INDEX audit_log_actor_idx ON audit.audit_log (actor_id, at DESC);

-- Append-only: no path, not even the owner's, updates or deletes an audit row.
CREATE OR REPLACE FUNCTION audit.refuse_change() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'audit.audit_log is append-only'; END $$;
CREATE TRIGGER audit_log_immutable BEFORE UPDATE OR DELETE ON audit.audit_log FOR EACH ROW EXECUTE FUNCTION audit.refuse_change();

CREATE OR REPLACE FUNCTION audit.log_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  before_j jsonb := CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN to_jsonb(OLD) END;
  after_j  jsonb := CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN to_jsonb(NEW) END;
  row_j    jsonb := coalesce(after_j, before_j);
BEGIN
  -- Never copy secrets into the log.
  before_j := before_j - 'password_hash' - 'token_hash' - 'code_hash' - 'hfx_key' - 'phone_enc' - 'loan_ref_enc' - 'policy_ref_enc';
  after_j  := after_j  - 'password_hash' - 'token_hash' - 'code_hash' - 'hfx_key' - 'phone_enc' - 'loan_ref_enc' - 'policy_ref_enc';
  INSERT INTO audit.audit_log (actor_id, is_service, action, schema_name, table_name, row_id, property_id, org_id, before, after)
  VALUES (
    app.actor_id(), app.is_service(), TG_OP, TG_TABLE_SCHEMA, TG_TABLE_NAME,
    coalesce(row_j->>'id', row_j->>'identity_id', row_j->>'property_id'),
    row_j->>'property_id',
    coalesce(row_j->>'org_id', row_j->>'grantee_org_id', row_j->>'requester_org_id', row_j->>'municipality_org_id'),
    before_j, after_j
  );
  RETURN NULL;
END $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'auth.identities','auth.credentials','people.profiles',
    'org.organizations','org.memberships','org.jurisdictions',
    'property.properties','property.property_owners','property.property_documents',
    'build.records','build.record_access',
    'access.grants','access.access_requests','access.share_links',
    'oversight.portfolio_holdings','oversight.loan_draws','oversight.policies','oversight.listings','oversight.permits','oversight.inspection_reviews'
  ] LOOP
    EXECUTE format('CREATE TRIGGER %I_audit AFTER INSERT OR UPDATE OR DELETE ON %s FOR EACH ROW EXECUTE FUNCTION audit.log_change()',
                   replace(t, '.', '_'), t);
  END LOOP;
END $$;

/* ======================== visibility functions ========================== */

-- The orgs the actor belongs to. SECURITY DEFINER so policies can ask without
-- recursing through the memberships policy.
CREATE OR REPLACE FUNCTION app.actor_org_ids() RETURNS SETOF text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT m.org_id FROM org.memberships m WHERE m.identity_id = app.actor_id()
$$;

CREATE OR REPLACE FUNCTION app.is_org_member(oid text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT EXISTS (SELECT 1 FROM org.memberships m WHERE m.org_id = oid AND m.identity_id = app.actor_id())
$$;

CREATE OR REPLACE FUNCTION app.is_org_admin(oid text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT EXISTS (SELECT 1 FROM org.memberships m
                 WHERE m.org_id = oid AND m.identity_id = app.actor_id() AND m.role IN ('owner','admin'))
$$;

-- The actor's widest scope on a property, or NULL. Every path in, in one place:
--   owner        the current homeowner                       → full
--   project      a member of a company on the build record   → full
--   grant        an explicit grant, to the actor or their org → its scope
--   jurisdiction a municipality whose territory covers it    → ledger
--   share_link   a valid share token in the transaction      → its scope
CREATE OR REPLACE FUNCTION app.property_scope(pid text) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  actor text := app.actor_id();
  best integer := 0;
  s integer;
BEGIN
  IF app.is_service() THEN RETURN 'full'; END IF;

  IF actor IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM property.property_owners o
               WHERE o.property_id = pid AND o.identity_id = actor AND o.until IS NULL) THEN
      RETURN 'full';
    END IF;
    IF EXISTS (SELECT 1 FROM build.records r
               JOIN build.record_access ra ON ra.record_id = r.id
               JOIN org.memberships m ON m.org_id = ra.org_id
               WHERE r.property_id = pid AND m.identity_id = actor) THEN
      RETURN 'full';
    END IF;
    SELECT max(access.scope_rank(g.scope)) INTO s FROM access.grants g
      WHERE g.property_id = pid AND g.revoked_at IS NULL
        AND (g.expires_at IS NULL OR g.expires_at > now())
        AND (g.grantee_identity_id = actor
             OR g.grantee_org_id IN (SELECT m.org_id FROM org.memberships m WHERE m.identity_id = actor));
    best := greatest(best, coalesce(s, 0));
    IF best < 3 AND EXISTS (
        SELECT 1 FROM property.properties p
        JOIN org.jurisdictions j ON j.state = p.state
          AND (   (j.city IS NOT NULL AND upper(j.city) = upper(p.city))
               OR (j.county IS NOT NULL AND p.county IS NOT NULL AND upper(j.county) = upper(p.county))
               OR (j.postal_code IS NOT NULL AND j.postal_code = p.postal_code))
        JOIN org.memberships m ON m.org_id = j.org_id
        JOIN org.organizations o ON o.id = j.org_id AND o.kind = 'municipality'
        WHERE p.id = pid AND m.identity_id = actor) THEN
      best := greatest(best, 2);
    END IF;
  END IF;

  IF app.share_hash() IS NOT NULL THEN
    SELECT access.scope_rank(l.scope) INTO s FROM access.share_links l
      WHERE l.property_id = pid AND l.token_hash = app.share_hash()
        AND l.revoked_at IS NULL AND (l.expires_at IS NULL OR l.expires_at > now());
    best := greatest(best, coalesce(s, 0));
  END IF;

  RETURN CASE best WHEN 3 THEN 'full' WHEN 2 THEN 'ledger' WHEN 1 THEN 'summary' ELSE NULL END;
END $$;

CREATE OR REPLACE FUNCTION app.can_view(pid text, needed text) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT access.scope_rank(app.property_scope(pid)) >= access.scope_rank(needed)
$$;

-- May the actor write to this property's build record (film, assign, add a company)?
CREATE OR REPLACE FUNCTION app.can_build(pid text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT app.is_service() OR EXISTS (
    SELECT 1 FROM build.records r
    JOIN build.record_access ra ON ra.record_id = r.id
    JOIN org.memberships m ON m.org_id = ra.org_id
    WHERE r.property_id = pid AND m.identity_id = app.actor_id())
$$;

CREATE OR REPLACE FUNCTION app.is_property_owner(pid text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT EXISTS (SELECT 1 FROM property.property_owners o
                 WHERE o.property_id = pid AND o.identity_id = app.actor_id() AND o.until IS NULL)
$$;

CREATE OR REPLACE FUNCTION app.record_property(rid text) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT r.property_id FROM build.records r WHERE r.id = rid
$$;

/* ============================== stats ================================== */

CREATE OR REPLACE FUNCTION property.recompute_stats(pid text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  INSERT INTO property.property_stats (property_id) VALUES (pid) ON CONFLICT DO NOTHING;
  UPDATE property.property_stats s SET
    stages_filmed = (SELECT count(*) FROM build.captures c WHERE c.property_id = pid AND c.state = 'done'),
    stages_in_flight = (SELECT count(*) FROM build.captures c WHERE c.property_id = pid AND c.state NOT IN ('done','failed')),
    points_passed = (SELECT count(*) FROM build.checkpoint_results r WHERE r.property_id = pid AND r.status = 'pass'),
    points_assessed = (SELECT count(*) FROM build.checkpoint_results r WHERE r.property_id = pid AND r.status <> 'not_assessable'),
    points_failed = (SELECT count(*) FROM build.checkpoint_results r WHERE r.property_id = pid AND r.status = 'fail'),
    open_safety_items = (SELECT count(*) FROM build.checkpoint_results r WHERE r.property_id = pid AND r.category = 'safety' AND r.status IN ('fail','attention')),
    open_moisture_items = (SELECT count(*) FROM build.checkpoint_results r WHERE r.property_id = pid AND r.category = 'moisture' AND r.status IN ('fail','attention')),
    critical_findings = (SELECT count(*) FROM build.findings f WHERE f.property_id = pid AND f.severity = 'critical' AND f.resolved_at IS NULL),
    major_findings = (SELECT count(*) FROM build.findings f WHERE f.property_id = pid AND f.severity = 'major' AND f.resolved_at IS NULL),
    latest_score = (SELECT g.score FROM build.stage_grades g WHERE g.property_id = pid ORDER BY g.filmed_at DESC LIMIT 1),
    latest_grade = (SELECT g.grade FROM build.stage_grades g WHERE g.property_id = pid ORDER BY g.filmed_at DESC LIMIT 1),
    latest_stage = (SELECT g.stage FROM build.stage_grades g WHERE g.property_id = pid ORDER BY g.filmed_at DESC LIMIT 1),
    mean_score = (SELECT avg(g.score) FROM build.stage_grades g WHERE g.property_id = pid),
    materials_lines = (SELECT count(*) FROM build.part_lines l WHERE l.property_id = pid),
    materials_total_cents = (SELECT coalesce(sum(round(l.quantity * l.unit_cost_cents)), 0) FROM build.part_lines l WHERE l.property_id = pid AND l.unit_cost_cents IS NOT NULL),
    measured_floor_area_m2 = (SELECT (c.job->'result'->'geometry'->>'floorAreaM2')::real FROM build.captures c
                              WHERE c.property_id = pid AND c.state = 'done' AND c.job->'result'->'geometry'->>'floorAreaM2' IS NOT NULL
                              ORDER BY c.updated_at DESC LIMIT 1),
    last_capture_at = (SELECT max(c.updated_at) FROM build.captures c WHERE c.property_id = pid AND c.state = 'done'),
    verified_stages = (SELECT count(DISTINCT ir.capture_id) FROM oversight.inspection_reviews ir WHERE ir.property_id = pid AND ir.verdict = 'verified'),
    flagged_stages = (SELECT count(DISTINCT ir.capture_id) FROM oversight.inspection_reviews ir WHERE ir.property_id = pid AND ir.verdict IN ('flagged','site_visit')),
    recomputed_at = now()
  WHERE s.property_id = pid;
END $$;

CREATE OR REPLACE FUNCTION property.stats_trigger() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM property.recompute_stats(coalesce(NEW.property_id, OLD.property_id));
  RETURN NULL;
END $$;
CREATE TRIGGER stage_grades_stats AFTER INSERT OR UPDATE OR DELETE ON build.stage_grades FOR EACH ROW EXECUTE FUNCTION property.stats_trigger();
CREATE TRIGGER inspection_reviews_stats AFTER INSERT OR UPDATE OR DELETE ON oversight.inspection_reviews FOR EACH ROW EXECUTE FUNCTION property.stats_trigger();

CREATE OR REPLACE FUNCTION property.init_stats() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  INSERT INTO property.property_stats (property_id) VALUES (NEW.id) ON CONFLICT DO NOTHING;
  RETURN NULL;
END $$;
CREATE TRIGGER properties_init_stats AFTER INSERT ON property.properties FOR EACH ROW EXECUTE FUNCTION property.init_stats();

/* ======================= row-level security ============================ */

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'auth.identities','auth.credentials','auth.sessions','auth.login_attempts','auth.password_resets',
    'people.profiles',
    'org.organizations','org.memberships','org.invitations','org.jurisdictions',
    'property.properties','property.property_owners','property.owner_invites','property.property_stats','property.property_events','property.property_documents',
    'build.records','build.record_access','build.captures','build.stage_grades','build.checkpoint_results','build.findings','build.part_lines','build.assignments','build.hires',
    'access.grants','access.access_requests','access.share_links','access.access_log',
    'oversight.portfolio_holdings','oversight.loan_draws','oversight.policies','oversight.listings','oversight.permits','oversight.inspection_reviews',
    'audit.audit_log'
  ] LOOP
    EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

-- auth: an identity sees itself; the service (login, signup) sees everything.
CREATE POLICY identities_self ON auth.identities FOR SELECT USING (app.is_service() OR id = app.actor_id());
CREATE POLICY identities_self_update ON auth.identities FOR UPDATE USING (app.is_service() OR id = app.actor_id());
CREATE POLICY identities_service_write ON auth.identities FOR INSERT WITH CHECK (app.is_service());
CREATE POLICY identities_service_delete ON auth.identities FOR DELETE USING (app.is_service());
-- credentials are only ever touched by the service path (login, change password, reset).
CREATE POLICY credentials_service ON auth.credentials USING (app.is_service()) WITH CHECK (app.is_service());
CREATE POLICY sessions_self ON auth.sessions FOR SELECT USING (app.is_service() OR identity_id = app.actor_id());
CREATE POLICY sessions_self_revoke ON auth.sessions FOR UPDATE USING (app.is_service() OR identity_id = app.actor_id());
CREATE POLICY sessions_service ON auth.sessions FOR INSERT WITH CHECK (app.is_service());
CREATE POLICY sessions_service_delete ON auth.sessions FOR DELETE USING (app.is_service() OR identity_id = app.actor_id());
CREATE POLICY login_attempts_service ON auth.login_attempts USING (app.is_service()) WITH CHECK (app.is_service());
CREATE POLICY password_resets_service ON auth.password_resets USING (app.is_service()) WITH CHECK (app.is_service());

-- people: public profiles are public; your own is yours; members of a shared org see each other.
CREATE POLICY profiles_read ON people.profiles FOR SELECT USING (
  app.is_service() OR is_public OR identity_id = app.actor_id()
  OR EXISTS (SELECT 1 FROM org.memberships a JOIN org.memberships b ON a.org_id = b.org_id
             WHERE a.identity_id = app.actor_id() AND b.identity_id = profiles.identity_id)
  -- the owner of a house you can see
  OR EXISTS (SELECT 1 FROM property.property_owners o WHERE o.identity_id = profiles.identity_id AND o.until IS NULL AND app.can_view(o.property_id, 'summary'))
);
CREATE POLICY profiles_self_write ON people.profiles FOR UPDATE USING (app.is_service() OR identity_id = app.actor_id());
CREATE POLICY profiles_insert ON people.profiles FOR INSERT WITH CHECK (app.is_service() OR identity_id = app.actor_id());

-- org
CREATE POLICY organizations_read ON org.organizations FOR SELECT USING (
  app.is_service() OR is_public OR app.is_org_member(id) OR owner_identity_id = app.actor_id()
  -- a company on a record you can see, or an institution that holds an interest you can see
  OR EXISTS (SELECT 1 FROM build.record_access ra JOIN build.records r ON r.id = ra.record_id WHERE ra.org_id = organizations.id AND app.can_view(r.property_id, 'summary'))
  OR EXISTS (SELECT 1 FROM access.grants g WHERE g.grantee_org_id = organizations.id AND g.revoked_at IS NULL AND app.is_property_owner(g.property_id))
  OR EXISTS (SELECT 1 FROM access.access_requests q WHERE q.requester_org_id = organizations.id AND app.is_property_owner(q.property_id))
  OR EXISTS (SELECT 1 FROM oversight.permits p WHERE p.municipality_org_id = organizations.id AND app.can_view(p.property_id, 'summary'))
  OR EXISTS (SELECT 1 FROM oversight.inspection_reviews ir WHERE ir.municipality_org_id = organizations.id AND app.can_view(ir.property_id, 'ledger'))
);
CREATE POLICY organizations_insert ON org.organizations FOR INSERT WITH CHECK (app.is_service() OR owner_identity_id = app.actor_id());
CREATE POLICY organizations_update ON org.organizations FOR UPDATE USING (app.is_service() OR app.is_org_admin(id));
CREATE POLICY organizations_delete ON org.organizations FOR DELETE USING (app.is_service() OR owner_identity_id = app.actor_id());

CREATE POLICY memberships_read ON org.memberships FOR SELECT USING (app.is_service() OR identity_id = app.actor_id() OR app.is_org_member(org_id));
CREATE POLICY memberships_write ON org.memberships FOR INSERT WITH CHECK (
  app.is_service() OR app.is_org_admin(org_id)
  OR (identity_id = app.actor_id() AND role = 'owner' AND EXISTS (SELECT 1 FROM org.organizations o WHERE o.id = org_id AND o.owner_identity_id = app.actor_id())));
CREATE POLICY memberships_update ON org.memberships FOR UPDATE USING (app.is_service() OR app.is_org_admin(org_id));
CREATE POLICY memberships_delete ON org.memberships FOR DELETE USING (app.is_service() OR app.is_org_admin(org_id) OR identity_id = app.actor_id());

CREATE POLICY invitations_admin ON org.invitations USING (app.is_service() OR app.is_org_admin(org_id)) WITH CHECK (app.is_service() OR app.is_org_admin(org_id));
CREATE POLICY jurisdictions_read ON org.jurisdictions FOR SELECT USING (true);
CREATE POLICY jurisdictions_admin ON org.jurisdictions FOR INSERT WITH CHECK (app.is_service() OR app.is_org_admin(org_id));
CREATE POLICY jurisdictions_admin_update ON org.jurisdictions FOR UPDATE USING (app.is_service() OR app.is_org_admin(org_id));
CREATE POLICY jurisdictions_admin_delete ON org.jurisdictions FOR DELETE USING (app.is_service() OR app.is_org_admin(org_id));

-- property
CREATE POLICY properties_read ON property.properties FOR SELECT USING (app.can_view(id, 'summary'));
CREATE POLICY properties_insert ON property.properties FOR INSERT WITH CHECK (app.is_service() OR app.actor_id() IS NOT NULL);
CREATE POLICY properties_update ON property.properties FOR UPDATE USING (app.is_service() OR app.is_property_owner(id) OR app.can_build(id));
CREATE POLICY properties_delete ON property.properties FOR DELETE USING (app.is_service());

CREATE POLICY property_owners_read ON property.property_owners FOR SELECT USING (app.can_view(property_id, 'summary'));
CREATE POLICY property_owners_write ON property.property_owners FOR INSERT WITH CHECK (app.is_service() OR app.is_property_owner(property_id));
CREATE POLICY property_owners_update ON property.property_owners FOR UPDATE USING (app.is_service() OR app.is_property_owner(property_id));
CREATE POLICY property_owners_delete ON property.property_owners FOR DELETE USING (app.is_service());

CREATE POLICY owner_invites_rw ON property.owner_invites USING (app.is_service() OR app.can_build(property_id) OR app.is_property_owner(property_id))
  WITH CHECK (app.is_service() OR app.can_build(property_id) OR app.is_property_owner(property_id));

CREATE POLICY property_stats_read ON property.property_stats FOR SELECT USING (app.can_view(property_id, 'summary'));
CREATE POLICY property_stats_service ON property.property_stats FOR ALL USING (app.is_service()) WITH CHECK (app.is_service());

CREATE POLICY property_events_read ON property.property_events FOR SELECT USING (app.can_view(property_id, visibility));
CREATE POLICY property_events_insert ON property.property_events FOR INSERT WITH CHECK (
  app.is_service() OR app.is_property_owner(property_id) OR app.can_build(property_id) OR app.can_view(property_id, 'ledger'));

CREATE POLICY property_documents_read ON property.property_documents FOR SELECT USING (app.can_view(property_id, 'full'));
CREATE POLICY property_documents_write ON property.property_documents FOR INSERT WITH CHECK (app.is_service() OR app.is_property_owner(property_id) OR app.can_build(property_id));
CREATE POLICY property_documents_delete ON property.property_documents FOR DELETE USING (app.is_service() OR app.is_property_owner(property_id) OR uploaded_by = app.actor_id());

-- build
CREATE POLICY records_read ON build.records FOR SELECT USING (app.can_view(property_id, 'summary') OR (org_id IS NOT NULL AND app.is_org_member(org_id)));
CREATE POLICY records_insert ON build.records FOR INSERT WITH CHECK (app.is_service() OR (org_id IS NOT NULL AND app.is_org_member(org_id)));
CREATE POLICY records_update ON build.records FOR UPDATE USING (app.can_build(property_id));
CREATE POLICY records_delete ON build.records FOR DELETE USING (app.is_service());

CREATE POLICY record_access_read ON build.record_access FOR SELECT USING (app.can_view(app.record_property(record_id), 'summary'));
CREATE POLICY record_access_write ON build.record_access FOR INSERT WITH CHECK (
  app.is_service() OR app.can_build(app.record_property(record_id))
  OR (role = 'owner' AND EXISTS (SELECT 1 FROM build.records r WHERE r.id = record_id AND r.org_id = record_access.org_id AND app.is_org_member(r.org_id))));
CREATE POLICY record_access_delete ON build.record_access FOR DELETE USING (app.is_service() OR app.can_build(app.record_property(record_id)));

CREATE POLICY captures_read ON build.captures FOR SELECT USING (app.can_view(property_id, 'ledger'));
CREATE POLICY captures_write ON build.captures FOR INSERT WITH CHECK (app.can_build(property_id));
CREATE POLICY captures_update ON build.captures FOR UPDATE USING (app.can_build(property_id));
CREATE POLICY captures_delete ON build.captures FOR DELETE USING (app.can_build(property_id));

CREATE POLICY stage_grades_read ON build.stage_grades FOR SELECT USING (app.can_view(property_id, 'summary'));
CREATE POLICY stage_grades_write ON build.stage_grades FOR ALL USING (app.can_build(property_id)) WITH CHECK (app.can_build(property_id));
CREATE POLICY checkpoint_results_read ON build.checkpoint_results FOR SELECT USING (app.can_view(property_id, 'ledger'));
CREATE POLICY checkpoint_results_write ON build.checkpoint_results FOR ALL USING (app.can_build(property_id)) WITH CHECK (app.can_build(property_id));
CREATE POLICY findings_read ON build.findings FOR SELECT USING (app.can_view(property_id, 'ledger'));
CREATE POLICY findings_write ON build.findings FOR ALL USING (app.can_build(property_id)) WITH CHECK (app.can_build(property_id));
CREATE POLICY part_lines_read ON build.part_lines FOR SELECT USING (app.can_view(property_id, 'full'));
CREATE POLICY part_lines_write ON build.part_lines FOR ALL USING (app.can_build(property_id)) WITH CHECK (app.can_build(property_id));

CREATE POLICY assignments_read ON build.assignments FOR SELECT USING (
  app.can_build(app.record_property(record_id)) OR assignee_identity_id = app.actor_id() OR (assignee_org_id IS NOT NULL AND app.is_org_member(assignee_org_id)));
CREATE POLICY assignments_write ON build.assignments FOR INSERT WITH CHECK (app.can_build(app.record_property(record_id)));
CREATE POLICY assignments_update ON build.assignments FOR UPDATE USING (
  app.can_build(app.record_property(record_id)) OR assignee_identity_id = app.actor_id() OR (assignee_org_id IS NOT NULL AND app.is_org_member(assignee_org_id)));
CREATE POLICY assignments_delete ON build.assignments FOR DELETE USING (app.can_build(app.record_property(record_id)));

CREATE POLICY hires_read ON build.hires FOR SELECT USING (
  app.is_service() OR app.is_org_member(from_org_id) OR to_identity_id = app.actor_id() OR (to_org_id IS NOT NULL AND app.is_org_member(to_org_id)));
CREATE POLICY hires_insert ON build.hires FOR INSERT WITH CHECK (app.is_service() OR app.is_org_member(from_org_id));
CREATE POLICY hires_update ON build.hires FOR UPDATE USING (
  app.is_service() OR app.is_org_member(from_org_id) OR to_identity_id = app.actor_id() OR (to_org_id IS NOT NULL AND app.is_org_member(to_org_id)));

-- access
CREATE POLICY grants_read ON access.grants FOR SELECT USING (
  app.is_service() OR app.is_property_owner(property_id) OR app.can_build(property_id)
  OR grantee_identity_id = app.actor_id() OR (grantee_org_id IS NOT NULL AND app.is_org_member(grantee_org_id)));
CREATE POLICY grants_insert ON access.grants FOR INSERT WITH CHECK (app.is_service() OR app.is_property_owner(property_id) OR app.can_build(property_id));
CREATE POLICY grants_update ON access.grants FOR UPDATE USING (app.is_service() OR app.is_property_owner(property_id) OR granted_by = app.actor_id());

CREATE POLICY access_requests_read ON access.access_requests FOR SELECT USING (
  app.is_service() OR app.is_property_owner(property_id) OR app.can_build(property_id) OR app.is_org_member(requester_org_id));
CREATE POLICY access_requests_insert ON access.access_requests FOR INSERT WITH CHECK (app.is_service() OR app.is_org_member(requester_org_id));
CREATE POLICY access_requests_update ON access.access_requests FOR UPDATE USING (
  app.is_service() OR app.is_property_owner(property_id) OR app.can_build(property_id) OR app.is_org_member(requester_org_id));

CREATE POLICY share_links_read ON access.share_links FOR SELECT USING (
  app.is_service() OR app.is_property_owner(property_id) OR created_by = app.actor_id() OR (created_by_org_id IS NOT NULL AND app.is_org_member(created_by_org_id)));
CREATE POLICY share_links_insert ON access.share_links FOR INSERT WITH CHECK (
  app.is_service() OR app.is_property_owner(property_id) OR app.can_view(property_id, 'full'));
CREATE POLICY share_links_update ON access.share_links FOR UPDATE USING (
  app.is_service() OR app.is_property_owner(property_id) OR created_by = app.actor_id());

CREATE POLICY access_log_read ON access.access_log FOR SELECT USING (
  app.is_service() OR app.is_property_owner(property_id) OR viewer_identity_id = app.actor_id() OR (viewer_org_id IS NOT NULL AND app.is_org_admin(viewer_org_id)));
CREATE POLICY access_log_insert ON access.access_log FOR INSERT WITH CHECK (true);

-- oversight: an institution's rows are its own; the homeowner sees what is held against their house.
CREATE POLICY holdings_rw ON oversight.portfolio_holdings USING (app.is_service() OR app.is_org_member(org_id) OR app.is_property_owner(property_id))
  WITH CHECK (app.is_service() OR app.is_org_member(org_id));
CREATE POLICY draws_read ON oversight.loan_draws FOR SELECT USING (
  app.is_service() OR app.is_property_owner(property_id) OR app.can_build(property_id)
  OR EXISTS (SELECT 1 FROM oversight.portfolio_holdings h WHERE h.id = holding_id AND app.is_org_member(h.org_id)));
CREATE POLICY draws_insert ON oversight.loan_draws FOR INSERT WITH CHECK (
  app.is_service() OR app.can_build(property_id)
  OR EXISTS (SELECT 1 FROM oversight.portfolio_holdings h WHERE h.id = holding_id AND app.is_org_member(h.org_id)));
CREATE POLICY draws_update ON oversight.loan_draws FOR UPDATE USING (
  app.is_service() OR EXISTS (SELECT 1 FROM oversight.portfolio_holdings h WHERE h.id = holding_id AND app.is_org_member(h.org_id)));
CREATE POLICY policies_rw ON oversight.policies USING (app.is_service() OR app.is_org_member(org_id) OR app.is_property_owner(property_id))
  WITH CHECK (app.is_service() OR app.is_org_member(org_id));
CREATE POLICY listings_rw ON oversight.listings USING (app.is_service() OR app.is_org_member(org_id) OR app.is_property_owner(property_id))
  WITH CHECK (app.is_service() OR app.is_org_member(org_id));
CREATE POLICY permits_read ON oversight.permits FOR SELECT USING (app.is_service() OR app.is_org_member(municipality_org_id) OR app.can_view(property_id, 'summary'));
CREATE POLICY permits_write ON oversight.permits FOR INSERT WITH CHECK (app.is_service() OR app.is_org_member(municipality_org_id));
CREATE POLICY permits_update ON oversight.permits FOR UPDATE USING (app.is_service() OR app.is_org_member(municipality_org_id));
CREATE POLICY reviews_read ON oversight.inspection_reviews FOR SELECT USING (app.is_service() OR app.is_org_member(municipality_org_id) OR app.can_view(property_id, 'ledger'));
CREATE POLICY reviews_write ON oversight.inspection_reviews FOR INSERT WITH CHECK (app.is_service() OR (app.is_org_member(municipality_org_id) AND app.can_view(property_id, 'ledger')));
CREATE POLICY reviews_update ON oversight.inspection_reviews FOR UPDATE USING (app.is_service() OR app.is_org_member(municipality_org_id));

-- audit: the service, the actor's own actions, org admins for their org, owners for their house.
CREATE POLICY audit_read ON audit.audit_log FOR SELECT USING (
  app.is_service() OR actor_id = app.actor_id()
  OR (org_id IS NOT NULL AND app.is_org_admin(org_id))
  OR (property_id IS NOT NULL AND app.is_property_owner(property_id)));
CREATE POLICY audit_insert ON audit.audit_log FOR INSERT WITH CHECK (true);

/* ============================== grants ================================= */

GRANT USAGE ON SCHEMA app, auth, people, org, property, build, access, oversight, audit TO homefax_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA auth, people, org, property, build, access, oversight TO homefax_app;
GRANT SELECT, INSERT ON audit.audit_log TO homefax_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA auth, access, audit TO homefax_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app, access, property, audit TO homefax_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA auth, people, org, property, build, access, oversight GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO homefax_app;
