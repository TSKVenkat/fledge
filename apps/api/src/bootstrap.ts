import { sql } from 'drizzle-orm';
import { users, type Database } from '@fledge/db';
import type { Env } from './env.ts';
import { hashPassword } from './auth/password.ts';

/**
 * Creates the first administrator, and only when the database has no users at
 * all. It therefore cannot be used to add an administrator to a running
 * instance by setting the variables and restarting.
 */
export async function bootstrapFirstAdmin(db: Database, env: Env): Promise<'created' | 'skipped'> {
  const rows = await db.select({ count: sql<number>`count(*)::int` }).from(users);
  if ((rows[0]?.count ?? 0) > 0) return 'skipped';
  if (!env.ADMIN_EMAIL || !env.ADMIN_PASSWORD) return 'skipped';

  await db.insert(users).values({
    email: env.ADMIN_EMAIL.toLowerCase(),
    name: 'Administrator',
    passwordHash: await hashPassword(env.ADMIN_PASSWORD),
    role: 'admin',
  });
  return 'created';
}
