// Writes every entry in the database to JSON, one file per entry.
//   npm run export                 -> content/tarpits/ (becomes the starter content for a fresh database)
//   npm run export -- backups/2026 -> any other folder
// With PGlite (no DATABASE_URL), stop the dev server first: only one process can open it.
import '../env.js';
import { resolve } from 'node:path';
import { CONTENT_DIR, exportContent } from '../content.js';
import { getDb } from '../db.js';

const dir = process.argv[2] ? resolve(process.argv[2]) : CONTENT_DIR;
const db = await getDb();
await exportContent(dir);
await db.close();
