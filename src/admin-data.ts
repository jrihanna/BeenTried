import { getDb } from './db.js';
import { removeAttempt } from './reports.js';
import type { SuggestionInput } from './suggestions.js';
import { isTag } from './tags.js';
import { isVerdict, type AttemptState, type Verdict } from './verdicts.js';

// Queries and validation behind the admin editor. Everything here edits the database directly.

export interface EditableTarpit {
  id: number;
  slug: string;
  title: string;
  category: string;
  summary: string;
  why_tempting: string;
  why_it_fails: string;
  what_would_change: string;
  keywords: string;
  status: 'draft' | 'reviewed';
  verdict: Verdict;
}

export interface EditableAttempt {
  id: number;
  company: string;
  start_year: number | null;
  end_year: number | null;
  outcome: string;
  notes: string;
  source_url: string | null;
  state: AttemptState;
  suggested_by: string | null;
  hidden_at: Date | null;
}

export interface EditableReason {
  id: number;
  tag: string;
  detail: string;
}

export interface EditableSource {
  id: number;
  title: string;
  url: string;
}

export interface EntryEditor {
  tarpit: EditableTarpit;
  attempts: EditableAttempt[];
  reasons: EditableReason[];
  sources: EditableSource[];
}

const TARPIT_COLUMNS = 'id, slug, title, category, summary, why_tempting, why_it_fails, what_would_change, keywords, status, verdict';
const ATTEMPT_COLUMNS = 'id, company, start_year, end_year, outcome, notes, source_url, state, suggested_by, hidden_at';

export async function getEntryEditor(id: number): Promise<EntryEditor | null> {
  const db = await getDb();
  const [tarpit] = await db.query<EditableTarpit>(`select ${TARPIT_COLUMNS} from tarpits where id = $1`, [id]);
  if (!tarpit) return null;
  const [attempts, reasons, sources] = await Promise.all([
    db.query<EditableAttempt>(
      `select ${ATTEMPT_COLUMNS} from attempts where tarpit_id = $1 order by start_year desc nulls last, id`,
      [id],
    ),
    db.query<EditableReason>('select id, tag, detail from reasons where tarpit_id = $1 order by position, id', [id]),
    db.query<EditableSource>('select id, title, url from sources where tarpit_id = $1 order by position, id', [id]),
  ]);
  return { tarpit, attempts, reasons, sources };
}

// ---------- Entries ----------

export type EntryValues = Partial<Record<keyof Omit<EditableTarpit, 'id'>, string>>;
export type EntryInput = Omit<EditableTarpit, 'id'>;

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

export function parseEntry(
  form: Record<string, unknown>,
): { ok: true; value: EntryInput } | { ok: false; error: string; values: EntryValues } {
  const field = (name: string) => (typeof form[name] === 'string' ? (form[name] as string).trim() : '');
  const values: EntryValues = {
    title: field('title'),
    slug: field('slug'),
    category: field('category'),
    summary: field('summary'),
    why_tempting: field('why_tempting'),
    why_it_fails: field('why_it_fails'),
    what_would_change: field('what_would_change'),
    keywords: field('keywords'),
    status: field('status') === 'reviewed' ? 'reviewed' : 'draft',
    verdict: field('verdict') || 'tarpit',
  };
  const fail = (error: string) => ({ ok: false as const, error, values });

  if (!values.title || values.title.length > 120) return fail('Add a title of up to 120 characters.');
  const slug = values.slug ? values.slug : slugify(values.title);
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) || slug.length > 80) {
    return fail('The URL name can only use lowercase letters, numbers and single dashes, like "music-discovery".');
  }
  if (!values.category || values.category.length > 40) return fail('Add a category of up to 40 characters.');
  if (!values.summary || values.summary.length > 300) return fail('Add a one-sentence summary of up to 300 characters.');
  for (const [key, label] of [
    ['why_tempting', 'Why it looks easy'],
    ['why_it_fails', 'Why it keeps failing'],
    ['what_would_change', 'What would have to be true now'],
  ] as const) {
    if ((values[key] ?? '').length > 6000) return fail(`${label} is too long. Keep it under 6,000 characters.`);
  }
  if ((values.keywords ?? '').length > 300) return fail('Keep keywords under 300 characters.');
  if (!isVerdict(values.verdict)) return fail('Pick a verdict: tarpit, contested or cracked.');

  return {
    ok: true,
    value: {
      title: values.title,
      slug,
      category: values.category,
      summary: values.summary,
      why_tempting: values.why_tempting ?? '',
      why_it_fails: values.why_it_fails ?? '',
      what_would_change: values.what_would_change ?? '',
      keywords: values.keywords ?? '',
      status: values.status as 'draft' | 'reviewed',
      verdict: values.verdict,
    },
  };
}

export async function slugTaken(slug: string, exceptId?: number): Promise<boolean> {
  const db = await getDb();
  const rows = await db.query('select 1 from tarpits where slug = $1 and id <> $2', [slug, exceptId ?? 0]);
  return rows.length > 0;
}

export async function createEntry(e: EntryInput): Promise<number> {
  const db = await getDb();
  const [{ id }] = await db.query<{ id: number }>(
    `insert into tarpits (slug, title, category, summary, why_tempting, why_it_fails, what_would_change, keywords, status, verdict)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning id`,
    [e.slug, e.title, e.category, e.summary, e.why_tempting, e.why_it_fails, e.what_would_change, e.keywords, e.status, e.verdict],
  );
  return id;
}

export async function updateEntry(id: number, e: EntryInput): Promise<void> {
  const db = await getDb();
  await db.query(
    `update tarpits set slug = $2, title = $3, category = $4, summary = $5, why_tempting = $6,
            why_it_fails = $7, what_would_change = $8, keywords = $9, status = $10, verdict = $11, updated_at = now()
      where id = $1`,
    [id, e.slug, e.title, e.category, e.summary, e.why_tempting, e.why_it_fails, e.what_would_change, e.keywords, e.status, e.verdict],
  );
}

export async function deleteEntry(id: number): Promise<void> {
  const db = await getDb();
  await db.query('delete from tarpits where id = $1', [id]);
}

// ---------- Companies ----------

export async function addAttempt(tarpitId: number, a: SuggestionInput): Promise<EditableAttempt> {
  const db = await getDb();
  const [row] = await db.query<EditableAttempt>(
    `insert into attempts (tarpit_id, company, start_year, end_year, outcome, notes, source_url, source, state)
     values ($1, $2, $3, $4, $5, $6, $7, 'admin', $8)
     returning ${ATTEMPT_COLUMNS}`,
    [tarpitId, a.company, a.startYear, a.endYear, a.outcome, a.notes, a.sourceUrl, a.state ?? 'ended'],
  );
  return row;
}

export async function updateAttempt(id: number, a: SuggestionInput): Promise<EditableAttempt | null> {
  const db = await getDb();
  const [row] = await db.query<EditableAttempt>(
    // Forms without a state field (the report review form) leave the state as it was.
    `update attempts set company = $2, start_year = $3, end_year = $4, outcome = $5, notes = $6, source_url = $7,
            state = coalesce($8, state)
      where id = $1 returning ${ATTEMPT_COLUMNS}`,
    [id, a.company, a.startYear, a.endYear, a.outcome, a.notes, a.sourceUrl, a.state ?? null],
  );
  return row ?? null;
}

/** Deletes a company, closing any open reports on it and recording the removal in moderation_log. */
export async function deleteAttempt(id: number): Promise<void> {
  await removeAttempt(id, 'Removed in admin');
}

// ---------- Reasons ----------

export function parseReason(form: Record<string, unknown>): { ok: true; tag: string; detail: string } | { ok: false; error: string } {
  const tag = typeof form.tag === 'string' ? form.tag : '';
  const detail = typeof form.detail === 'string' ? form.detail.trim() : '';
  if (!isTag(tag)) return { ok: false, error: 'Pick a reason from the list.' };
  if (!detail || detail.length > 300) return { ok: false, error: 'Explain the reason in up to 300 characters.' };
  return { ok: true, tag, detail };
}

export async function addReason(tarpitId: number, tag: string, detail: string): Promise<EditableReason> {
  const db = await getDb();
  const [row] = await db.query<EditableReason>(
    `insert into reasons (tarpit_id, tag, detail, position)
     values ($1, $2, $3, (select coalesce(max(position), -1) + 1 from reasons where tarpit_id = $1))
     returning id, tag, detail`,
    [tarpitId, tag, detail],
  );
  return row;
}

export async function updateReason(id: number, tag: string, detail: string): Promise<EditableReason | null> {
  const db = await getDb();
  const [row] = await db.query<EditableReason>(
    'update reasons set tag = $2, detail = $3 where id = $1 returning id, tag, detail',
    [id, tag, detail],
  );
  return row ?? null;
}

export async function deleteReason(id: number): Promise<void> {
  const db = await getDb();
  await db.query('delete from reasons where id = $1', [id]);
}

// ---------- Sources ----------

export function parseSource(form: Record<string, unknown>): { ok: true; title: string; url: string } | { ok: false; error: string } {
  const title = typeof form.title === 'string' ? form.title.trim() : '';
  const raw = typeof form.url === 'string' ? form.url.trim() : '';
  if (!title || title.length > 200) return { ok: false, error: 'Add a title of up to 200 characters.' };
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('bad protocol');
    if (raw.length > 500) throw new Error('too long');
    return { ok: true, title, url: url.toString() };
  } catch {
    return { ok: false, error: 'The link needs to be a web address starting with https://' };
  }
}

export async function addSource(tarpitId: number, title: string, url: string): Promise<EditableSource> {
  const db = await getDb();
  const [row] = await db.query<EditableSource>(
    `insert into sources (tarpit_id, title, url, position)
     values ($1, $2, $3, (select coalesce(max(position), -1) + 1 from sources where tarpit_id = $1))
     returning id, title, url`,
    [tarpitId, title, url],
  );
  return row;
}

export async function updateSource(id: number, title: string, url: string): Promise<EditableSource | null> {
  const db = await getDb();
  const [row] = await db.query<EditableSource>(
    'update sources set title = $2, url = $3 where id = $1 returning id, title, url',
    [id, title, url],
  );
  return row ?? null;
}

export async function deleteSource(id: number): Promise<void> {
  const db = await getDb();
  await db.query('delete from sources where id = $1', [id]);
}
