import { createHash, randomBytes } from 'node:crypto';
import { and, eq, gt, lt } from 'drizzle-orm';
import type { Database } from '@fledge/db';
import { sessions, users } from '@fledge/db';

export const SESSION_COOKIE = 'fledge_session';
const TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Sessions are rows, not signed tokens, so revocation is a delete rather than a
 * wait. The cookie holds a random token; the database holds only its hash.
 */
const hash = (token: string) => createHash('sha256').update(token).digest('hex');

export interface AuthUser {
  id: string; name: string; role: 'admin' | 'teacher' | 'student';
  email: string | null; username: string | null; mustChangePassword: boolean;
}

export async function createSession(db: Database, userId: string): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + TTL_MS);
  await db.insert(sessions).values({ userId, tokenHash: hash(token), expiresAt });
  return { token, expiresAt };
}

export async function resolveSession(db: Database, token: string): Promise<AuthUser | null> {
  const rows = await db
    .select({
      id: users.id, name: users.name, role: users.role, email: users.email,
      username: users.username, mustChangePassword: users.mustChangePassword, isActive: users.isActive,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, hash(token)), gt(sessions.expiresAt, new Date())))
    .limit(1);

  const row = rows[0];
  // isActive is checked here rather than at sign-in, so disabling an account
  // takes effect on that account's very next request.
  if (!row || !row.isActive) return null;
  return {
    id: row.id, name: row.name, role: row.role, email: row.email,
    username: row.username, mustChangePassword: row.mustChangePassword,
  };
}

export const revokeSession = (db: Database, token: string) =>
  db.delete(sessions).where(eq(sessions.tokenHash, hash(token)));

/** Used when an account is disabled, its role changes, or its password changes. */
export const revokeAllSessions = (db: Database, userId: string) =>
  db.delete(sessions).where(eq(sessions.userId, userId));

export const deleteExpiredSessions = (db: Database) =>
  db.delete(sessions).where(lt(sessions.expiresAt, new Date()));
