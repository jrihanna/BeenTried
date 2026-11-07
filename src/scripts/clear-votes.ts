// Dev helper: deletes votes so you can test voting again.
//   npx tsx src/scripts/clear-votes.ts          deletes the most recent vote
//   npx tsx src/scripts/clear-votes.ts --all    deletes every vote
// With PGlite (no DATABASE_URL), stop the dev server first: only one process can open it.
import '../env.js';
import { getDb } from '../db.js';

if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to run with NODE_ENV=production.');
  process.exit(1);
}

const all = process.argv.includes('--all');
const db = await getDb();
const rows = await db.query<{ tarpit_id: number; verdict: string }>(
  all
    ? 'delete from votes returning tarpit_id, verdict'
    : 'delete from votes where updated_at = (select max(updated_at) from votes) returning tarpit_id, verdict',
);
console.log(rows.length ? `Deleted ${rows.length} vote(s):` : 'No votes to delete.', rows.length ? rows : '');
await db.close();
