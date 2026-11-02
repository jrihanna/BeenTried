import { mkdirSync, readFileSync } from 'node:fs';

export interface Db {
  kind: 'postgres' | 'pglite';
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
  exec(sql: string): Promise<void>;
  close(): Promise<void>;
}

let instance: Promise<Db> | undefined;

/**
 * Returns a shared database handle.
 * With DATABASE_URL set it connects to that Postgres (needs the pgvector extension).
 * Without it, it runs PGlite, an embedded Postgres stored on disk in ./.data, so the
 * site works with nothing but `npm install`.
 */
export function getDb(): Promise<Db> {
  instance ??= connect();
  return instance;
}

async function connect(): Promise<Db> {
  const url = process.env.DATABASE_URL?.trim();
  let db: Db;

  if (url) {
    const { default: postgres } = await import('postgres');
    const sql = postgres(url, { onnotice: () => {} });
    db = {
      kind: 'postgres',
      query: async (text, params = []) => (await sql.unsafe(text, params as never[])) as never,
      exec: async (text) => {
        await sql.unsafe(text);
      },
      close: () => sql.end(),
    };
  } else {
    const { PGlite } = await import('@electric-sql/pglite');
    const { vector } = await import('@electric-sql/pglite/vector');
    const dir = process.env.PGLITE_DIR || './.data/pglite';
    mkdirSync(dir, { recursive: true });
    const pg = await PGlite.create(dir, { extensions: { vector } });
    db = {
      kind: 'pglite',
      query: async (text, params = []) => (await pg.query(text, params)).rows as never,
      exec: async (text) => {
        await pg.exec(text);
      },
      close: () => pg.close(),
    };
  }

  await db.exec(readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8'));
  return db;
}

/** pgvector accepts vectors as a '[1,2,3]' string literal cast with ::vector. */
export function toVector(values: number[]): string {
  return `[${values.join(',')}]`;
}
