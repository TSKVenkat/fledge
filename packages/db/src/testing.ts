/**
 * An in-process Postgres for tests.
 *
 * One instance per worker rather than per test, with a truncate between: a
 * fresh database per test is correct and far too slow, and the truncate keeps
 * the isolation without the cost. An integration test then costs about what a
 * unit test does, which is what makes it reasonable to write many.
 */
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { sql } from 'drizzle-orm';
import { resolve } from 'node:path';
import * as schema from './schema.ts';
import type { Database } from './client.ts';

let shared: Promise<Database> | null = null;

export function testDatabase(): Promise<Database> {
  shared ??= (async () => {
    const client = new PGlite();
    const db = drizzle(client, { schema });
    // The real migrations, so a migration that fails in production fails here.
    await migrate(db, { migrationsFolder: resolve(import.meta.dirname, '../drizzle') });
    return db as unknown as Database;
  })();
  return shared;
}

export async function reset(db: Database): Promise<void> {
  await db.execute(sql`
    do $$
    declare r record;
    begin
      for r in (select tablename from pg_tables where schemaname = 'public'
                and tablename <> '__drizzle_migrations')
      loop
        execute 'truncate table public.' || quote_ident(r.tablename) || ' restart identity cascade';
      end loop;
    end $$;
  `);
}
