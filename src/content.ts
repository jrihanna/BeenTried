import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { aiEnabled, embed } from './ai.js';
import { getDb, toVector } from './db.js';
import { isTag } from './tags.js';

/**
 * The database is the source of truth. JSON files are only an import/export format:
 * - On first start (empty database) the server imports content/tarpits/*.json as starter content.
 * - `npm run seed` imports files whose slug isn't in the database yet. It never changes existing entries.
 * - `npm run export` writes every entry, with all its companies, reasons and sources, back to JSON.
 */

/** Shape of each file in content/tarpits/*.json. */
export interface TarpitFile {
  slug: string;
  title: string;
  category: string;
  summary: string;
  whyTempting: string;
  whyItFails: string;
  whatWouldChange: string;
  keywords?: string;
  status?: 'draft' | 'reviewed';
  attempts: {
    company: string;
    startYear?: number;
    endYear?: number;
    outcome: string;
    notes?: string;
    sourceUrl?: string;
    suggestedBy?: string;
    /** Hidden while a report is reviewed. Stays hidden when imported. */
    hidden?: boolean;
  }[];
  reasons: { tag: string; detail: string }[];
  sources?: { title: string; url: string }[];
}

export const CONTENT_DIR = fileURLToPath(new URL('../content/tarpits/', import.meta.url));

export function readContentFiles(dir = CONTENT_DIR): TarpitFile[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((file) => {
      const data = JSON.parse(readFileSync(join(dir, file), 'utf8')) as TarpitFile;
      validate(data, file);
      return data;
    });
}

function validate(t: TarpitFile, file: string): void {
  const required = ['slug', 'title', 'category', 'summary', 'whyTempting', 'whyItFails', 'whatWouldChange'] as const;
  for (const key of required) {
    if (typeof t[key] !== 'string' || !t[key].trim()) throw new Error(`${file}: "${key}" is required`);
  }
  if (!/^[a-z0-9-]+$/.test(t.slug)) throw new Error(`${file}: slug must be lowercase letters, numbers and dashes`);
  if (!Array.isArray(t.attempts)) throw new Error(`${file}: "attempts" must be a list`);
  for (const r of t.reasons ?? []) {
    if (!isTag(r.tag)) throw new Error(`${file}: unknown reason tag "${r.tag}" (see src/tags.ts)`);
  }
}

/**
 * Inserts entries from JSON whose slug isn't in the database yet. Existing entries are
 * skipped untouched, so edits made in /admin are never overwritten.
 */
export async function importContent(log: (msg: string) => void = console.log, dir = CONTENT_DIR): Promise<void> {
  const db = await getDb();
  const files = readContentFiles(dir);
  let added = 0;

  for (const t of files) {
    const [existing] = await db.query<{ id: number }>('select id from tarpits where slug = $1', [t.slug]);
    if (existing) {
      log(`  ${t.slug}: already in the database, skipped`);
      continue;
    }

    const [{ id }] = await db.query<{ id: number }>(
      `insert into tarpits (slug, title, category, summary, why_tempting, why_it_fails,
                            what_would_change, keywords, status)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       returning id`,
      [t.slug, t.title, t.category, t.summary, t.whyTempting, t.whyItFails, t.whatWouldChange,
        t.keywords ?? '', t.status ?? 'draft'],
    );
    for (const a of t.attempts) {
      await db.query(
        `insert into attempts (tarpit_id, company, start_year, end_year, outcome, notes, source_url, suggested_by, source,
                               hidden_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, case when $10::boolean then now() end)`,
        [id, a.company, a.startYear ?? null, a.endYear ?? null, a.outcome, a.notes ?? '', a.sourceUrl ?? null,
          a.suggestedBy ?? null, a.suggestedBy ? 'community' : 'admin', a.hidden === true],
      );
    }
    for (const [i, r] of (t.reasons ?? []).entries()) {
      await db.query('insert into reasons (tarpit_id, tag, detail, position) values ($1, $2, $3, $4)',
        [id, r.tag, r.detail, i]);
    }
    for (const [i, s] of (t.sources ?? []).entries()) {
      await db.query('insert into sources (tarpit_id, title, url, position) values ($1, $2, $3, $4)',
        [id, s.title, s.url, i]);
    }
    await refreshEmbedding(id).catch((err) => log(`  ${t.slug}: embedding failed (${err})`));
    added++;
    log(`  ${t.slug}: imported`);
  }
  log(`Imported ${added} new ${added === 1 ? 'entry' : 'entries'}, skipped ${files.length - added}.`);
}

/** Writes every entry in the database to <dir>/<slug>.json. */
export async function exportContent(dir: string, log: (msg: string) => void = console.log): Promise<void> {
  const db = await getDb();
  mkdirSync(dir, { recursive: true });
  const tarpits = await db.query<{
    id: number; slug: string; title: string; category: string; summary: string; why_tempting: string;
    why_it_fails: string; what_would_change: string; keywords: string; status: 'draft' | 'reviewed';
  }>('select id, slug, title, category, summary, why_tempting, why_it_fails, what_would_change, keywords, status from tarpits order by slug');

  for (const t of tarpits) {
    const [attempts, reasons, sources] = await Promise.all([
      db.query<{ company: string; start_year: number | null; end_year: number | null; outcome: string; notes: string; source_url: string | null; suggested_by: string | null; hidden: boolean }>(
        `select company, start_year, end_year, outcome, notes, source_url, suggested_by, hidden_at is not null as hidden
           from attempts where tarpit_id = $1 order by start_year nulls last, id`,
        [t.id],
      ),
      db.query<{ tag: string; detail: string }>('select tag, detail from reasons where tarpit_id = $1 order by position, id', [t.id]),
      db.query<{ title: string; url: string }>('select title, url from sources where tarpit_id = $1 order by position, id', [t.id]),
    ]);

    // Leave out empty optional fields so the files stay readable.
    const clean = <T extends object>(o: T) =>
      Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== undefined && v !== '')) as T;

    const file: TarpitFile = {
      slug: t.slug,
      title: t.title,
      category: t.category,
      summary: t.summary,
      keywords: t.keywords || undefined,
      status: t.status,
      whyTempting: t.why_tempting,
      whyItFails: t.why_it_fails,
      whatWouldChange: t.what_would_change,
      attempts: attempts.map((a) =>
        clean({
          company: a.company,
          startYear: a.start_year ?? undefined,
          endYear: a.end_year ?? undefined,
          outcome: a.outcome,
          notes: a.notes,
          sourceUrl: a.source_url ?? undefined,
          suggestedBy: a.suggested_by ?? undefined,
          hidden: a.hidden || undefined,
        }),
      ),
      reasons,
      sources,
    };
    writeFileSync(join(dir, `${t.slug}.json`), `${JSON.stringify(clean(file), null, 2)}\n`);
    log(`  ${t.slug}.json`);
  }
  log(`Exported ${tarpits.length} entries to ${dir}`);
}

/**
 * Recomputes an entry's embedding for the idea checker when its text has changed.
 * Does nothing without OPENAI_API_KEY.
 */
export async function refreshEmbedding(tarpitId: number): Promise<void> {
  if (!aiEnabled()) return;
  const db = await getDb();
  const [t] = await db.query<{ text: string; content_hash: string | null; has_embedding: boolean }>(
    `select concat_ws(E'\\n', title, summary, why_tempting, keywords) as text, content_hash,
            embedding is not null as has_embedding
       from tarpits where id = $1`,
    [tarpitId],
  );
  if (!t) return;
  const hash = createHash('sha256').update(t.text).digest('hex');
  if (t.has_embedding && t.content_hash === hash) return;
  const vector = await embed(t.text);
  await db.query('update tarpits set embedding = $1::vector, content_hash = $2 where id = $3',
    [toVector(vector), hash, tarpitId]);
}

export async function isEmpty(): Promise<boolean> {
  const db = await getDb();
  const [{ n }] = await db.query<{ n: number }>('select count(*)::int as n from tarpits');
  return n === 0;
}
