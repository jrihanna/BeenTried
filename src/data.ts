import { getDb } from './db.js';

export interface TarpitSummary {
  id: number;
  slug: string;
  title: string;
  category: string;
  summary: string;
  status: 'draft' | 'reviewed';
  attempt_count: number;
  earliest_year: number | null;
  comment_count: number;
}

export interface Attempt {
  id: number;
  company: string;
  start_year: number | null;
  end_year: number | null;
  outcome: string;
  notes: string;
  source_url: string | null;
  source: 'content' | 'community';
  suggested_by: string | null;
}

export interface Reason {
  tag: string;
  detail: string;
}

export interface Source {
  title: string;
  url: string;
}

export interface Tarpit extends TarpitSummary {
  why_tempting: string;
  why_it_fails: string;
  what_would_change: string;
  attempts: Attempt[];
  /** Companies hidden while a report is reviewed. Counted on the page, never named. */
  hidden_attempts: number;
  reasons: Reason[];
  sources: Source[];
}

export interface Comment {
  id: number;
  parent_id: number | null;
  author_name: string;
  body: string;
  created_at: Date;
  replies: Comment[];
}

export interface VoteTally {
  still: number;
  cracked: number;
  mine: 'still' | 'cracked' | null;
}

/**
 * Whether unreviewed (draft) entries are shown to visitors. Defaults to shown in development and
 * hidden in production; set PUBLISH_DRAFTS=true or false to override. Admin pages always see drafts.
 */
export function draftsArePublic(): boolean {
  const v = process.env.PUBLISH_DRAFTS?.trim().toLowerCase();
  if (v === 'true') return true;
  if (v === 'false') return false;
  return process.env.NODE_ENV !== 'production';
}

const SUMMARY_COLUMNS = `
  t.id, t.slug, t.title, t.category, t.summary, t.status,
  (select count(*)::int from attempts a where a.tarpit_id = t.id and a.hidden_at is null) as attempt_count,
  (select min(a.start_year) from attempts a where a.tarpit_id = t.id and a.hidden_at is null) as earliest_year,
  (select count(*)::int from comments c where c.tarpit_id = t.id and not c.hidden) as comment_count
`;

export async function listTarpits(
  opts: { q?: string; category?: string; includeDrafts?: boolean } = {},
): Promise<TarpitSummary[]> {
  const db = await getDb();
  const q = opts.q?.trim() || null;
  const category = opts.category?.trim() || null;
  return db.query<TarpitSummary>(
    `select ${SUMMARY_COLUMNS}
       from tarpits t
      where ($3::boolean or t.status = 'reviewed')
        and ($1::text is null or t.category = $1)
        and ($2::text is null
             or t.search @@ websearch_to_tsquery('english', $2)
             or t.title ilike '%' || $2 || '%'
             or t.keywords ilike '%' || $2 || '%')
      order by
        case when $2::text is null then 0
             else ts_rank(t.search, websearch_to_tsquery('english', $2)) end desc,
        attempt_count desc,
        t.title`,
    [category, q, opts.includeDrafts ?? draftsArePublic()],
  );
}

export async function listCategories(opts: { includeDrafts?: boolean } = {}): Promise<string[]> {
  const db = await getDb();
  const rows = await db.query<{ category: string }>(
    `select distinct category from tarpits where $1::boolean or status = 'reviewed' order by category`,
    [opts.includeDrafts ?? draftsArePublic()],
  );
  return rows.map((r) => r.category);
}

export async function getTarpit(slug: string, opts: { includeDrafts?: boolean } = {}): Promise<Tarpit | null> {
  const db = await getDb();
  const [row] = await db.query<Omit<Tarpit, 'attempts' | 'reasons' | 'sources'>>(
    `select ${SUMMARY_COLUMNS}, t.why_tempting, t.why_it_fails, t.what_would_change,
            (select count(*)::int from attempts a where a.tarpit_id = t.id and a.hidden_at is not null) as hidden_attempts
       from tarpits t where t.slug = $1 and ($2::boolean or t.status = 'reviewed')`,
    [slug, opts.includeDrafts ?? draftsArePublic()],
  );
  if (!row) return null;

  const [attempts, reasons, sources] = await Promise.all([
    db.query<Attempt>(
      `select id, company, start_year, end_year, outcome, notes, source_url, source, suggested_by
         from attempts where tarpit_id = $1 and hidden_at is null
        order by start_year desc nulls last, position`,
      [row.id],
    ),
    db.query<Reason>('select tag, detail from reasons where tarpit_id = $1 order by position', [row.id]),
    db.query<Source>('select title, url from sources where tarpit_id = $1 order by position', [row.id]),
  ]);

  return { ...row, attempts, reasons, sources };
}

export async function getComments(tarpitId: number): Promise<Comment[]> {
  const db = await getDb();
  const rows = await db.query<Omit<Comment, 'replies'>>(
    `select id, parent_id, author_name, body, created_at
       from comments
      where tarpit_id = $1 and not hidden
      order by created_at`,
    [tarpitId],
  );

  const byId = new Map<number, Comment>();
  for (const row of rows) byId.set(row.id, { ...row, replies: [] });

  const roots: Comment[] = [];
  for (const comment of byId.values()) {
    const parent = comment.parent_id ? byId.get(comment.parent_id) : undefined;
    if (parent) parent.replies.push(comment);
    else if (!comment.parent_id) roots.push(comment);
    // Replies to hidden comments are dropped along with their parent.
  }
  // Newest conversations first; replies stay in the order they were written.
  return roots.reverse();
}

export async function getComment(id: number): Promise<Omit<Comment, 'replies'> & { tarpit_id: number } | null> {
  const db = await getDb();
  const [row] = await db.query<Omit<Comment, 'replies'> & { tarpit_id: number }>(
    'select id, tarpit_id, parent_id, author_name, body, created_at from comments where id = $1 and not hidden',
    [id],
  );
  return row ?? null;
}

export async function addComment(input: {
  tarpitId: number;
  parentId: number | null;
  authorName: string;
  body: string;
  ipHash: string;
}): Promise<Comment> {
  const db = await getDb();
  const [row] = await db.query<Omit<Comment, 'replies'>>(
    `insert into comments (tarpit_id, parent_id, author_name, body, ip_hash)
     values ($1, $2, $3, $4, $5)
     returning id, parent_id, author_name, body, created_at`,
    [input.tarpitId, input.parentId, input.authorName, input.body, input.ipHash],
  );
  return { ...row, replies: [] };
}

export async function getVotes(tarpitId: number, voter: string): Promise<VoteTally> {
  const db = await getDb();
  const [row] = await db.query<VoteTally>(
    `select
       count(*) filter (where verdict = 'still')::int as still,
       count(*) filter (where verdict = 'cracked')::int as cracked,
       max(case when voter = $2 then verdict end) as mine
     from votes where tarpit_id = $1`,
    [tarpitId, voter],
  );
  return row;
}

export async function castVote(tarpitId: number, voter: string, verdict: 'still' | 'cracked'): Promise<void> {
  const db = await getDb();
  await db.query(
    `insert into votes (tarpit_id, voter, verdict) values ($1, $2, $3)
     on conflict (tarpit_id, voter) do update set verdict = excluded.verdict, updated_at = now()`,
    [tarpitId, voter, verdict],
  );
}

export async function logIdeaCheck(idea: string, slugs: string[], mode: string): Promise<void> {
  const db = await getDb();
  await db.query(
    `insert into idea_checks (idea, matched_slugs, mode)
     values ($1, array(select jsonb_array_elements_text($2::jsonb)), $3)`,
    [idea, JSON.stringify(slugs), mode],
  );
}

// ---------- Admin ----------

export interface AdminComment {
  id: number;
  author_name: string;
  body: string;
  hidden: boolean;
  created_at: Date;
  slug: string;
  title: string;
}

export async function adminListComments(): Promise<AdminComment[]> {
  const db = await getDb();
  return db.query<AdminComment>(
    `select c.id, c.author_name, c.body, c.hidden, c.created_at, t.slug, t.title
       from comments c join tarpits t on t.id = c.tarpit_id
      order by c.created_at desc limit 200`,
  );
}

export async function adminToggleComment(id: number): Promise<AdminComment | null> {
  const db = await getDb();
  await db.query('update comments set hidden = not hidden where id = $1', [id]);
  const [row] = await db.query<AdminComment>(
    `select c.id, c.author_name, c.body, c.hidden, c.created_at, t.slug, t.title
       from comments c join tarpits t on t.id = c.tarpit_id where c.id = $1`,
    [id],
  );
  return row ?? null;
}

export async function adminToggleStatus(id: number): Promise<TarpitSummary | null> {
  const db = await getDb();
  await db.query(
    `update tarpits set status = case when status = 'draft' then 'reviewed' else 'draft' end,
            updated_at = now() where id = $1`,
    [id],
  );
  const [row] = await db.query<TarpitSummary>(`select ${SUMMARY_COLUMNS} from tarpits t where t.id = $1`, [id]);
  return row ?? null;
}

export interface AdminCheck {
  idea: string;
  matched_slugs: string[];
  mode: string;
  created_at: Date;
}

export async function adminRecentChecks(): Promise<AdminCheck[]> {
  const db = await getDb();
  return db.query<AdminCheck>(
    `select idea, to_jsonb(matched_slugs) as matched_slugs, mode, created_at
       from idea_checks order by created_at desc limit 50`,
  );
}

export interface NeedsCheck {
  id: number;
  slug: string;
  title: string;
  status: 'draft' | 'reviewed';
  companies: number;
  /** Companies on this entry with no source link. */
  unsourced: string[];
}

/** Entries that are still drafts, or list a company without a source. Drafts first. */
export async function adminNeedsChecking(): Promise<NeedsCheck[]> {
  const db = await getDb();
  return db.query<NeedsCheck>(
    `select t.id, t.slug, t.title, t.status,
            (select count(*)::int from attempts a where a.tarpit_id = t.id) as companies,
            coalesce((select jsonb_agg(a.company order by a.company) from attempts a
                       where a.tarpit_id = t.id and coalesce(a.source_url, '') = ''), '[]'::jsonb) as unsourced
       from tarpits t
      where t.status = 'draft'
         or exists (select 1 from attempts a where a.tarpit_id = t.id and coalesce(a.source_url, '') = '')
      order by t.status, t.title`,
  );
}
