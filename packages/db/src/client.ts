import { drizzle } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import postgres from 'postgres';
import * as schema from './schema.ts';

/**
 * Deliberately the driver-agnostic type. Production runs on postgres-js and
 * tests run on an in-process PGlite, and every caller should work with either
 * without knowing which it has.
 */
export type Database = PgDatabase<PgQueryResultHKT, typeof schema>;

export function createDatabase(connectionString: string): { db: Database; close: () => Promise<void> } {
  const client = postgres(connectionString, { max: 10 });
  return { db: drizzle(client, { schema }) as Database, close: () => client.end() };
}

/** Used by the readiness probe. Liveness must never touch the database. */
export async function ping(db: Database): Promise<void> {
  await db.execute(sql`select 1`);
}
