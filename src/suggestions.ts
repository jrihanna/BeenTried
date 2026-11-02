import { getDb } from './db.js';

/** A company suggestion after validation, ready to store or approve. */
export interface SuggestionInput {
  company: string;
  startYear: number | null;
  endYear: number | null;
  outcome: string;
  notes: string;
  /** Always set for visitor suggestions; optional when you add a company yourself in admin. */
  sourceUrl: string | null;
  submitterName: string | null;
}

/** Raw form values, echoed back into the form when validation fails. */
export type SuggestionValues = Partial<Record<'company' | 'start_year' | 'end_year' | 'outcome' | 'notes' | 'source_url' | 'submitter_name', string>>;

export type ParseResult = { ok: true; value: SuggestionInput } | { ok: false; error: string; values: SuggestionValues };

const EARLIEST_YEAR = 1980;

export function formValues(form: Record<string, unknown>): SuggestionValues {
  const field = (name: string) => (typeof form[name] === 'string' ? (form[name] as string).trim() : '');
  return {
    company: field('company'),
    start_year: field('start_year'),
    end_year: field('end_year'),
    outcome: field('outcome'),
    notes: field('notes'),
    source_url: field('source_url'),
    submitter_name: field('submitter_name'),
  };
}

/** Validates a company (an "attempt") from a form. Visitors must give a source; admins may skip it. */
export function parseSuggestion(form: Record<string, unknown>, opts: { requireSource?: boolean } = {}): ParseResult {
  const requireSource = opts.requireSource ?? true;
  const values = formValues(form);
  const fail = (error: string): ParseResult => ({ ok: false, error, values });
  const latestYear = new Date().getFullYear();

  const year = (raw: string, label: string): number | null | string => {
    if (!raw) return null;
    if (!/^\d{4}$/.test(raw)) return `${label} should be a four-digit year.`;
    const n = Number(raw);
    if (n < EARLIEST_YEAR || n > latestYear) return `${label} should be between ${EARLIEST_YEAR} and ${latestYear}.`;
    return n;
  };

  if (!values.company || values.company.length > 80) return fail('Add the company name, up to 80 characters.');
  const startYear = year(values.start_year!, 'Start year');
  if (typeof startYear === 'string') return fail(startYear);
  const endYear = year(values.end_year!, 'End year');
  if (typeof endYear === 'string') return fail(endYear);
  if (startYear && endYear && endYear < startYear) return fail("The end year can't be before the start year.");
  if (!values.outcome || values.outcome.length > 80) return fail('Say how it ended, up to 80 characters. For example "Shut down".');
  if (values.notes!.length > 280) return fail('Keep the note to 280 characters.');
  if ((values.submitter_name ?? '').length > 60) return fail('Keep your name to 60 characters.');

  let sourceUrl: string | null = null;
  if (values.source_url || requireSource) {
    let url: URL;
    try {
      url = new URL(values.source_url!);
    } catch {
      return fail('Add a link to a source, such as a news article or shutdown post, starting with https://');
    }
    if ((url.protocol !== 'https:' && url.protocol !== 'http:') || values.source_url!.length > 500) {
      return fail('The source needs to be a web link starting with https://');
    }
    sourceUrl = url.toString();
  }

  return {
    ok: true,
    value: {
      company: values.company,
      startYear,
      endYear,
      outcome: values.outcome,
      notes: values.notes!,
      sourceUrl,
      submitterName: values.submitter_name || null,
    },
  };
}

/** Company names compared without case, spaces or punctuation, so "Kozmo.com" matches "kozmo com". */
const NORMALISE = (col: string) => `lower(regexp_replace(${col}, '[^a-zA-Z0-9]', '', 'g'))`;

export async function findDuplicate(tarpitId: number, company: string): Promise<'listed' | 'pending' | null> {
  const db = await getDb();
  const [row] = await db.query<{ listed: boolean; pending: boolean }>(
    `select
       exists (select 1 from attempts where tarpit_id = $1 and ${NORMALISE('company')} = ${NORMALISE('$2')}) as listed,
       exists (select 1 from attempt_suggestions where tarpit_id = $1 and status = 'pending'
                 and ${NORMALISE('company')} = ${NORMALISE('$2')}) as pending`,
    [tarpitId, company],
  );
  if (row.listed) return 'listed';
  if (row.pending) return 'pending';
  return null;
}

export async function createSuggestion(tarpitId: number, s: SuggestionInput, ipHash: string): Promise<void> {
  const db = await getDb();
  await db.query(
    `insert into attempt_suggestions
       (tarpit_id, company, start_year, end_year, outcome, notes, source_url, submitter_name, ip_hash)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [tarpitId, s.company, s.startYear, s.endYear, s.outcome, s.notes, s.sourceUrl, s.submitterName, ipHash],
  );
}

// ---------- Admin ----------

export interface PendingSuggestion {
  id: number;
  slug: string;
  title: string;
  company: string;
  start_year: number | null;
  end_year: number | null;
  outcome: string;
  notes: string;
  source_url: string;
  submitter_name: string | null;
  created_at: Date;
  /** Entries where a company with the same name is already listed. */
  also_listed: { slug: string; title: string }[];
}

export async function listPendingSuggestions(): Promise<PendingSuggestion[]> {
  const db = await getDb();
  return db.query<PendingSuggestion>(
    `select s.id, t.slug, t.title, s.company, s.start_year, s.end_year, s.outcome, s.notes,
            s.source_url, s.submitter_name, s.created_at,
            coalesce((select jsonb_agg(distinct jsonb_build_object('slug', t2.slug, 'title', t2.title))
                        from attempts a join tarpits t2 on t2.id = a.tarpit_id
                       where ${NORMALISE('a.company')} = ${NORMALISE('s.company')}), '[]'::jsonb) as also_listed
       from attempt_suggestions s join tarpits t on t.id = s.tarpit_id
      where s.status = 'pending'
      order by s.created_at`,
  );
}

/**
 * Publishes a suggestion as a community attempt, using the reviewer's edited values.
 * Returns null if the suggestion doesn't exist or was already reviewed.
 */
export async function approveSuggestion(
  id: number,
  s: SuggestionInput,
): Promise<{ slug: string; title: string; company: string } | null> {
  const db = await getDb();
  const [created] = await db.query<{ attempt_id: number; slug: string; title: string }>(
    `with s as (
       update attempt_suggestions set status = 'approved', reviewed_at = now()
        where id = $1 and status = 'pending'
       returning tarpit_id, submitter_name
     ), a as (
       insert into attempts (tarpit_id, company, start_year, end_year, outcome, notes, source_url,
                             position, source, suggested_by)
       select tarpit_id, $2, $3, $4, $5, $6, $7, 1000, 'community', submitter_name from s
       returning id, tarpit_id
     )
     select a.id as attempt_id, t.slug, t.title from a join tarpits t on t.id = a.tarpit_id`,
    [id, s.company, s.startYear, s.endYear, s.outcome, s.notes, s.sourceUrl],
  );
  if (!created) return null;
  await db.query('update attempt_suggestions set attempt_id = $2 where id = $1', [id, created.attempt_id]);
  return { slug: created.slug, title: created.title, company: s.company };
}

export async function rejectSuggestion(id: number): Promise<boolean> {
  const db = await getDb();
  const rows = await db.query(
    `update attempt_suggestions set status = 'rejected', reviewed_at = now()
      where id = $1 and status = 'pending' returning id`,
    [id],
  );
  return rows.length > 0;
}

export interface CommunityAttempt {
  id: number;
  company: string;
  start_year: number | null;
  end_year: number | null;
  outcome: string;
  suggested_by: string | null;
  slug: string;
  title: string;
}

export async function listCommunityAttempts(): Promise<CommunityAttempt[]> {
  const db = await getDb();
  return db.query<CommunityAttempt>(
    `select a.id, a.company, a.start_year, a.end_year, a.outcome, a.suggested_by, t.slug, t.title
       from attempts a join tarpits t on t.id = a.tarpit_id
      where a.source = 'community'
      order by a.id desc limit 100`,
  );
}

export async function deleteCommunityAttempt(id: number): Promise<void> {
  const db = await getDb();
  await db.query("delete from attempts where id = $1 and source = 'community'", [id]);
}
