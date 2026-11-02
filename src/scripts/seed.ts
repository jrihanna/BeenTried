// Imports entries from content/tarpits/*.json whose slug isn't in the database yet.
// Existing entries are never changed: edit those in /admin.
// With PGlite (no DATABASE_URL), stop the dev server first: only one process can open it.
import '../env.js';
import { importContent } from '../content.js';
import { getDb } from '../db.js';

const db = await getDb();
console.log(`Importing into ${db.kind} database…`);
await importContent();
await db.close();
