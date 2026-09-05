/** Applies migrations, then exits. Run as its own step before the API starts. */
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { resolve } from 'node:path';

const url = process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL is not set.'); process.exit(1); }

// max: 1 — migrations must run on one connection, in order.
const client = postgres(url, { max: 1 });
await migrate(drizzle(client), { migrationsFolder: resolve(import.meta.dirname, '../drizzle') });
await client.end();
console.log('migrations applied');
