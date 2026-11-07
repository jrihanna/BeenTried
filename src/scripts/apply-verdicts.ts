// Applies a backfill file of company states, removals and entry verdicts.
//
//   npm run apply-verdicts -- content/additions/2026-11-verdicts.json          -> dry run: prints what would change
//   npm run apply-verdicts -- content/additions/2026-11-verdicts.json --apply  -> makes the changes
//
// File shape:
//   {
//     "active":   [{ "slug": "...", "company": "..." }],             listed under "Still operating"
//     "ended":    [{ "slug": "...", "company": "..." }],             moved back under "Who tried"
//     "remove":   [{ "slug": "...", "company": "...", "why": "..." }],  deleted and recorded in moderation_log
//     "verdicts": [{ "slug": "...", "verdict": "tarpit" | "contested" | "cracked" }]
//   }
// Companies are matched by name without case or punctuation. Running a file twice is safe.
// Afterwards it lists every "tarpit" entry left with fewer than MIN_ENDED_FOR_TARPIT sourced
// ended companies, reviewed ones first, since those are public.
// With PGlite (no DATABASE_URL), stop the dev server first: only one process can open it.
import '../env.js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getDb } from '../db.js';
import { removeAttempt } from '../reports.js';
import { isVerdict, MIN_ENDED_FOR_TARPIT, type AttemptState, type Verdict } from '../verdicts.js';

interface Backfill {
  active?: { slug: string; company: string }[];
  ended?: { slug: string; company: string }[];
  remove?: { slug: string; company: string; why?: string }[];
  verdicts?: { slug: string; verdict: Verdict }[];
}

const file = process.argv[2];
const apply = process.argv.includes('--apply');
if (!file || file.startsWith('--')) {
  console.error('Usage: npm run apply-verdicts -- <file.json> [--apply]');
  process.exit(1);
}
const backfill = JSON.parse(readFileSync(resolve(file), 'utf8')) as Backfill;
for (const v of backfill.verdicts ?? []) {
  if (!isVerdict(v.verdict)) throw new Error(`${v.slug}: unknown verdict "${v.verdict}"`);
}

const normalise = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

const db = await getDb();
const tarpits = await db.query<{ id: number; slug: string; status: string; verdict: Verdict }>(
  'select id, slug, status, verdict from tarpits',
);
const attempts = await db.query<{
  id: number; tarpit_id: number; company: string; state: AttemptState; source_url: string | null; hidden: boolean;
}>('select id, tarpit_id, company, state, source_url, hidden_at is not null as hidden from attempts');

const bySlug = new Map(tarpits.map((t) => [t.slug, t]));
const problems: string[] = [];

function find(slug: string, company: string) {
  const t = bySlug.get(slug);
  if (!t) {
    problems.push(`${slug}: no such entry`);
    return null;
  }
  const a = attempts.find((x) => x.tarpit_id === t.id && normalise(x.company) === normalise(company));
  if (!a) problems.push(`${slug}: no company called "${company}"`);
  return a ?? null;
}

console.log(apply ? 'Applying changes.\n' : 'Dry run. Nothing is saved; add --apply to make these changes.\n');

// Company states. Changes are mirrored into `attempts` so the summary below shows the result.
for (const [state, list] of [['active', backfill.active ?? []], ['ended', backfill.ended ?? []]] as const) {
  for (const { slug, company } of list) {
    const a = find(slug, company);
    if (!a) continue;
    if (a.state === state) {
      console.log(`  ${slug}: ${a.company} is already ${state}`);
      continue;
    }
    console.log(`  ${slug}: ${a.company} -> ${state === 'active' ? 'Still operating' : 'Who tried'}`);
    if (apply) await db.query('update attempts set state = $2 where id = $1', [a.id, state]);
    a.state = state;
  }
}

for (const { slug, company, why } of backfill.remove ?? []) {
  const a = find(slug, company);
  if (!a) continue;
  console.log(`  ${slug}: remove ${a.company}${why ? ` (${why})` : ''}`);
  if (apply) await removeAttempt(a.id, `Removed in verdict backfill${why ? `: ${why}` : ''}`);
  attempts.splice(attempts.indexOf(a), 1);
}

for (const { slug, verdict } of backfill.verdicts ?? []) {
  const t = bySlug.get(slug);
  if (!t) {
    problems.push(`${slug}: no such entry`);
    continue;
  }
  if (t.verdict === verdict) {
    console.log(`  ${slug}: verdict is already ${verdict}`);
    continue;
  }
  console.log(`  ${slug}: verdict ${t.verdict} -> ${verdict}`);
  if (apply) await db.query('update tarpits set verdict = $2, updated_at = now() where id = $1', [t.id, verdict]);
  t.verdict = verdict;
}

// What the tarpit rule says once these changes are in.
const short = tarpits
  .filter((t) => t.verdict === 'tarpit')
  .map((t) => ({
    ...t,
    endedSourced: attempts.filter(
      (a) => a.tarpit_id === t.id && a.state === 'ended' && !a.hidden && (a.source_url ?? '') !== '',
    ).length,
  }))
  .filter((t) => t.endedSourced < MIN_ENDED_FOR_TARPIT)
  .sort((a, b) => Number(b.status === 'reviewed') - Number(a.status === 'reviewed') || a.slug.localeCompare(b.slug));

console.log(
  `\n${short.length} tarpit ${short.length === 1 ? 'entry has' : 'entries have'} fewer than ${MIN_ENDED_FOR_TARPIT} sourced ended companies${apply ? '' : ' after these changes'}:`,
);
for (const t of short) {
  console.log(`  ${t.status === 'reviewed' ? 'REVIEWED ' : ''}${t.slug}: ${t.endedSourced}`);
}
if (short.some((t) => t.status === 'reviewed')) {
  console.log('Reviewed entries above are public. Add an ended company, change the verdict, or mark them unreviewed.');
}

if (problems.length) {
  console.log(`\nNot found, skipped:\n  ${problems.join('\n  ')}`);
}
await db.close();
