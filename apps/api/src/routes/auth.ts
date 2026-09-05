import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq, or } from 'drizzle-orm';
import { users, type Database } from '@fledge/db';
import type { Env } from '../env.ts';
import { badRequest, unauthorized } from '../errors.ts';
import { hashPassword, passwordProblem, verifyPassword } from '../auth/password.ts';
import { SESSION_COOKIE, createSession, revokeAllSessions, revokeSession } from '../auth/sessions.ts';
import { requireAuth } from '../auth/guards.ts';

const loginBody = z.object({
  // One field: a teacher signs in with an email, a child with a username, and
  // neither should have to know which box theirs goes in.
  identifier: z.string().min(1).max(200),
  password: z.string().min(1).max(200),
});
const passwordBody = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(1).max(200),
});

export function authRoutes(app: FastifyInstance, db: Database, env: Env): void {
  const cookieOptions = {
    httpOnly: true, sameSite: 'lax' as const,
    secure: env.NODE_ENV === 'production', path: '/',
  };

  app.post('/v1/auth/login', {
    config: {
      rateLimit: {
        max: 10, timeWindow: '1 minute',
        // Keyed on address AND account. Keying only on the address means
        // everyone behind one school router shares a budget.
        keyGenerator: (request: { ip: string; body?: unknown }) => {
          const identifier = (request.body as { identifier?: string } | undefined)?.identifier ?? '';
          return `${request.ip}:${identifier.toLowerCase()}`;
        },
      },
    },
  }, async (request, reply) => {
    const body = loginBody.parse(request.body);
    const identifier = body.identifier.trim().toLowerCase();

    const found = await db.select().from(users)
      .where(or(eq(users.email, identifier), eq(users.username, identifier))).limit(1);
    const user = found[0];

    // Verified even when nothing matched, so a wrong identifier and a wrong
    // password take the same time and give the same answer.
    const ok = await verifyPassword(body.password, user?.passwordHash ?? null);
    if (!user || !ok || !user.isActive) throw unauthorized('That did not match an account.');

    const { token, expiresAt } = await createSession(db, user.id);
    reply.setCookie(SESSION_COOKIE, token, { ...cookieOptions, expires: expiresAt });
    return {
      user: {
        id: user.id, name: user.name, role: user.role, email: user.email,
        username: user.username, mustChangePassword: user.mustChangePassword,
      },
    };
  });

  app.post('/v1/auth/logout', async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE];
    if (token) await revokeSession(db, token);
    reply.clearCookie(SESSION_COOKIE, cookieOptions);
    return reply.status(204).send();
  });

  app.get('/v1/auth/me', async (request) => {
    const user = requireAuth(request);
    return { user };
  });

  app.post('/v1/auth/password', async (request, reply) => {
    const user = requireAuth(request);
    const body = passwordBody.parse(request.body);
    const problem = passwordProblem(body.newPassword, env.PASSWORD_MIN_LENGTH);
    if (problem) throw badRequest('WEAK_PASSWORD', problem);

    const rows = await db.select().from(users).where(eq(users.id, user.id)).limit(1);
    const row = rows[0];
    if (!row || !(await verifyPassword(body.currentPassword, row.passwordHash))) {
      throw unauthorized('That is not the current password.');
    }

    await db.update(users)
      .set({ passwordHash: await hashPassword(body.newPassword), mustChangePassword: false, updatedAt: new Date() })
      .where(eq(users.id, user.id));
    // Every session, including this one: a password change should end any
    // session someone else might be holding.
    await revokeAllSessions(db, user.id);
    reply.clearCookie(SESSION_COOKIE, cookieOptions);
    return reply.status(204).send();
  });
}
