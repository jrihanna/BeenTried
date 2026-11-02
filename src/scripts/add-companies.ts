// Adds companies to entries that are already in the database, from content/additions/*.json.
// `npm run seed` never changes existing entries, so researched companies come in this way.
//
//   npm run add-companies                     -> every file in content/additions/
//   npm run add-companies -- some/file.json
//   npm run add-companies -- content/tarpits  -> fills in companies missing from existing entries
//
// Each file is either a list of { "slug": "...", "attempts": [ same shape as in content/tarpits ] }
// or a single entry file from content/tarpits (an object with "slug" and "attempts").
// Companies without a source are added with a warning, the same as the starter import; every
// researched company in content/additions has one. A company already listed on that entry (compared without case or punctuation) is skipped, so
// running a file twice is safe. Entries keep their status: review them in /admin as usual.
// With PGlite (no DATABASE_URL), stop the dev server first: only one process can open it.
import '../env.js';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { TarpitFile } from '../content.js';
import { getDb } from '../db.js';

type Addition = { slug: string; attempts: TarpitFile['attempts'] };

const ADDITIONS_DIR = fileURLToPath(new URL('../../content/additions/', import.meta.url));
const jsonFilesIn = (dir: string) =>
  readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => join(dir, f));

const target = process.argv[2] ? resolve(process.argv[2]) : ADDITIONS_DIR;
const files = statSync(target).isDirectory() ? jsonFilesIn(target) : [target];

const normalise = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

const db = await getDb();
let added = 0;
let skipped = 0;
const unsourced: string[] = [];
const missing: string[] = [];

for (const file of files) {
  const parsed = JSON.parse(readFileSync(file, 'utf8')) as Addition | Addition[];
  const additions = Array.isArray(parsed) ? parsed : [parsed];
  for (const { slug, attempts = [] } of additions) {
    const [tarpit] = await db.query<{ id: number }>('select id from tarpits where slug = $1', [slug]);
    if (!tarpit) {
      missing.push(slug);
      continue;
    }
    const existing = new Set(
      (await db.query<{ company: string }>('select company from attempts where tarpit_id = $1', [tarpit.id])).map(
        (r) => normalise(r.company),
      ),
    );
    for (const a of attempts) {
      if (!a.company || !a.outcome) {
        console.warn(`  ${slug}: skipped a company with no name or outcome`);
        continue;
      }
      if (existing.has(normalise(a.company))) {
        skipped++;
        continue;
      }
      await db.query(
        `insert into attempts (tarpit_id, company, start_year, end_year, outcome, notes, source_url, source)
         values ($1, $2, $3, $4, $5, $6, $7, 'content')`,
        [tarpit.id, a.company, a.startYear ?? null, a.endYear ?? null, a.outcome, a.notes ?? '', a.sourceUrl ?? null],
      );
      existing.add(normalise(a.company));
      added++;
      if (!a.sourceUrl) unsourced.push(`${slug}: ${a.company}`);
      console.log(`  ${slug}: added ${a.company}${a.sourceUrl ? '' : ' (no source)'}`);
    }
  }
}

console.log(`Added ${added} ${added === 1 ? 'company' : 'companies'}, skipped ${skipped} already listed.`);
if (unsourced.length) {
  console.log(`Added without a source (add one in /admin before marking the entry reviewed): ${unsourced.join('; ')}`);
}
if (missing.length) console.log(`Not in the database, skipped: ${missing.join(', ')}`);
await db.close();
