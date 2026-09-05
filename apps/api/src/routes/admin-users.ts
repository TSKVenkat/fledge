import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { desc, eq } from 'drizzle-orm';
import { users, type Database } from '@fledge/db';
import type { Env } from '../env.ts';
import { badRequest, conflict, notFound } from '../errors.ts';
import { requireAdmin } from '../auth/guards.ts';
import { hashPassword, passwordProblem } from '../auth/password.ts';
import { revokeAllSessions } from '../auth/sessions.ts';

/**
 * How teachers come to exist. The first administrator is created from the
 * environment, exactly once; everyone after that is created here, by an
 * administrator, on purpose. There is no self-registration: a school decides
 * who teaches in it.
 */
const createBody = z.object({
  name: z.string().min(1).max(120),
  email: z.string().email().max(200),
  password: z.string().min(1).max(200),
  role: z.enum(['admin', 'teacher']).default('teacher'),
});
const patchBody = z.object({
  name: z.string().min(1).max(120).optional(),
  role: z.enum(['admin', 'teacher', 'student']).optional(),
  isActive: z.boolean().optional(),
});
const passwordBody = z.object({ password: z.string().min(1).max(200) });
const idParams = z.object({ id: z.string().uuid() });

/** Never the hash. */
const shape = (u: typeof users.$inferSelect) => ({
  id: u.id, name: u.name, email: u.email, username: u.username, role: u.role,
  isActive: u.isActive, mustChangePassword: u.mustChangePassword, createdAt: u.createdAt,
});

export function adminUserRoutes(app: FastifyInstance, db: Database, env: Env): void {
  app.get('/v1/admin/users', async (request) => {
    requireAdmin(request);
    const rows = await db.select().from(users).orderBy(desc(users.createdAt)).limit(500);
    return { users: rows.map(shape) };
  });

  app.post('/v1/admin/users', async (request, reply) => {
    requireAdmin(request);
    const body = createBody.parse(request.body);
    const problem = passwordProblem(body.password, env.PASSWORD_MIN_LENGTH);
    if (problem) throw badRequest('WEAK_PASSWORD', problem);
    const email = body.email.toLowerCase();
    const taken = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
    if (taken.length > 0) throw conflict('EMAIL_TAKEN', 'An account already uses that email address.');
    const [created] = await db.insert(users).values({
      name: body.name, email, role: body.role, passwordHash: await hashPassword(body.password),
      // A password set by someone else is not yet the owner's own.
      mustChangePassword: true,
    }).returning();
    return reply.status(201).send({ user: shape(created!) });
  });

  app.patch('/v1/admin/users/:id', async (request) => {
    const admin = requireAdmin(request);
    const { id } = idParams.parse(request.params);
    const body = patchBody.parse(request.body ?? {});
    // The last thing an administrator should be able to do by accident is lock
    // themselves out of their own instance.
    if (id === admin.id && (body.isActive === false || (body.role && body.role !== 'admin'))) {
      throw badRequest('SELF_LOCKOUT', 'You cannot disable or demote your own account.');
    }
    const [updated] = await db.update(users).set({ ...body, updatedAt: new Date() })
      .where(eq(users.id, id)).returning();
    if (!updated) throw notFound();
    // A role change or a disabling takes effect on the next request, not the
    // next sign-in.
    if (body.isActive === false || body.role !== undefined) await revokeAllSessions(db, id);
    return { user: shape(updated) };
  });

  /** An administrator resets a password; there is no email, so this is the reset flow. */
  app.post('/v1/admin/users/:id/password', async (request, reply) => {
    requireAdmin(request);
    const { id } = idParams.parse(request.params);
    const body = passwordBody.parse(request.body);
    const problem = passwordProblem(body.password, env.PASSWORD_MIN_LENGTH);
    if (problem) throw badRequest('WEAK_PASSWORD', problem);
    const [updated] = await db.update(users)
      .set({ passwordHash: await hashPassword(body.password), mustChangePassword: true, updatedAt: new Date() })
      .where(eq(users.id, id)).returning();
    if (!updated) throw notFound();
    await revokeAllSessions(db, id);
    return reply.status(204).send();
  });
}
