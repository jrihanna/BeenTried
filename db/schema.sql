-- Idempotent schema. Runs automatically every time the server or seed script starts.

create extension if not exists vector;

create table if not exists tarpits (
  id                serial primary key,
  slug              text not null unique,
  title             text not null,
  category          text not null,
  summary           text not null,
  why_tempting      text not null default '',
  why_it_fails      text not null default '',
  what_would_change text not null default '',
  keywords          text not null default '',
  status            text not null default 'draft' check (status in ('draft', 'reviewed')),
  content_hash      text,
  embedding         vector(1536),
  search            tsvector generated always as (
                      setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
                      setweight(to_tsvector('english', coalesce(keywords, '')), 'A') ||
                      setweight(to_tsvector('english', coalesce(summary, '')), 'B') ||
                      setweight(to_tsvector('english', coalesce(why_tempting, '')), 'C')
                    ) stored,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists tarpits_search_idx on tarpits using gin (search);

-- Companies that tried the idea. Rendered as the strata column on each page.
create table if not exists attempts (
  id          serial primary key,
  tarpit_id   integer not null references tarpits (id) on delete cascade,
  company     text not null,
  start_year  integer,
  end_year    integer,
  outcome     text not null,
  notes       text not null default '',
  source_url  text,
  position    integer not null default 0
);

create index if not exists attempts_tarpit_idx on attempts (tarpit_id);

-- Where a company came from: 'admin' or 'content' (added by you, in /admin or the starter JSON)
-- or 'community' (suggested by a visitor and approved). All of them are edited the same way in /admin.
alter table attempts add column if not exists source text not null default 'content';
alter table attempts add column if not exists suggested_by text;

-- Companies visitors suggest for the "Who tried" column. Nothing here is public until approved.
create table if not exists attempt_suggestions (
  id              serial primary key,
  tarpit_id       integer not null references tarpits (id) on delete cascade,
  company         text not null,
  start_year      integer,
  end_year        integer,
  outcome         text not null,
  notes           text not null default '',
  source_url      text not null,
  submitter_name  text,
  ip_hash         text,
  status          text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  attempt_id      integer references attempts (id) on delete set null,
  created_at      timestamptz not null default now(),
  reviewed_at     timestamptz
);

create index if not exists attempt_suggestions_status_idx on attempt_suggestions (status, created_at);

-- Why it keeps failing, tagged with a shared vocabulary (see src/tags.ts).
create table if not exists reasons (
  id         serial primary key,
  tarpit_id  integer not null references tarpits (id) on delete cascade,
  tag        text not null,
  detail     text not null,
  position   integer not null default 0
);

create index if not exists reasons_tarpit_idx on reasons (tarpit_id);

create table if not exists sources (
  id         serial primary key,
  tarpit_id  integer not null references tarpits (id) on delete cascade,
  title      text not null,
  url        text not null,
  position   integer not null default 0
);

create index if not exists sources_tarpit_idx on sources (tarpit_id);

create table if not exists comments (
  id           serial primary key,
  tarpit_id    integer not null references tarpits (id) on delete cascade,
  parent_id    integer references comments (id) on delete cascade,
  author_name  text not null,
  body         text not null,
  ip_hash      text,
  hidden       boolean not null default false,
  created_at   timestamptz not null default now()
);

create index if not exists comments_tarpit_idx on comments (tarpit_id, created_at);

-- "Is this still a tarpit?" One vote per visitor per entry; voting again changes it.
create table if not exists votes (
  tarpit_id   integer not null references tarpits (id) on delete cascade,
  voter       text not null,
  verdict     text not null check (verdict in ('still', 'cracked')),
  updated_at  timestamptz not null default now(),
  primary key (tarpit_id, voter)
);

-- What people run through the idea checker, so you can see which tarpits are missing.
create table if not exists idea_checks (
  id             serial primary key,
  idea           text not null,
  matched_slugs  text[] not null default '{}',
  mode           text not null,
  created_at     timestamptz not null default now()
);

-- ---------- Reports on "Who tried" ----------
-- A visitor can report a company listed under an entry. The report hides the company from the
-- public page in the same statement, then waits in /admin for you to restore, fix or remove it.
alter table attempts add column if not exists hidden_at timestamptz;

create table if not exists attempt_reports (
  id              serial primary key,
  attempt_id      integer references attempts (id) on delete set null,
  tarpit_id       integer references tarpits (id) on delete set null,
  -- Copied from the attempt so the report still makes sense after the company is removed.
  company         text not null,
  reason          text not null check (reason in ('inaccurate', 'defamatory', 'privacy', 'other')),
  details         text not null default '',
  reporter_email  text,
  ip_hash         text,
  -- False when the company was already hidden, or the hourly auto-hide limit was reached.
  auto_hidden     boolean not null default false,
  status          text not null default 'open' check (status in ('open', 'restored', 'edited', 'removed')),
  -- Advisory notes from the automatic check (source reachable, AI assessment). Never acted on automatically.
  triage          jsonb,
  created_at      timestamptz not null default now(),
  reviewed_at     timestamptz
);

create index if not exists attempt_reports_status_idx on attempt_reports (status, created_at);
create index if not exists attempt_reports_attempt_idx on attempt_reports (attempt_id);

-- Every hide, restore, edit and removal of a reported company, with when it happened.
-- No foreign keys, so the record survives the company being deleted.
create table if not exists moderation_log (
  id          serial primary key,
  attempt_id  integer,
  report_id   integer,
  company     text not null,
  action      text not null,
  actor       text not null,
  note        text not null default '',
  created_at  timestamptz not null default now()
);

-- ---------- Reports on comments ----------
-- Same idea as attempt reports: the comment is hidden in the statement that records the report,
-- and waits in /admin. "Remove" keeps it hidden for good rather than deleting it, so replies and
-- the record survive.
create table if not exists comment_reports (
  id              serial primary key,
  comment_id      integer references comments (id) on delete set null,
  tarpit_id       integer references tarpits (id) on delete set null,
  reason          text not null check (reason in ('defamatory', 'privacy', 'abuse', 'spam', 'other')),
  details         text not null default '',
  reporter_email  text,
  ip_hash         text,
  auto_hidden     boolean not null default false,
  status          text not null default 'open' check (status in ('open', 'restored', 'removed')),
  created_at      timestamptz not null default now(),
  reviewed_at     timestamptz
);

create index if not exists comment_reports_status_idx on comment_reports (status, created_at);
create index if not exists comment_reports_comment_idx on comment_reports (comment_id);

-- moderation_log covers comments too. For comment rows, "company" holds the comment's author name.
alter table moderation_log add column if not exists target text not null default 'attempt';
alter table moderation_log add column if not exists comment_id integer;
