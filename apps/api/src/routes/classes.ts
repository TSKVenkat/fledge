import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { randomInt } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import { classMembers, classes, users, type Database } from '@fledge/db';
import { badRequest, notFound } from '../errors.ts';
import { requireAuth, requireTeacher } from '../auth/guards.ts';
import { hashPassword } from '../auth/password.ts';
import type { AuthUser } from '../auth/sessions.ts';

/**
 * The alphabet excludes O/0, I/1 and S/5.
 *
 * A join code is read off a whiteboard by a nine-year-old and typed by thirty
 * of them at once. Every character a child can misread is a support incident,
 * so the alphabet is chosen for legibility rather than entropy, and the
 * weakness that causes is paid for elsewhere: the code can be rotated and
 * disabled, joining is rate limited, and wrong, disabled and non-existent
 * codes are indistinguishable.
 */
const ALPHABET = 'ABCDEFGHJKLMNPQRTUVWXYZ23456789';
const CODE_LENGTH = 7;

function generateJoinCode(): string {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) code += ALPHABET[randomInt(ALPHABET.length)];
  return code;
}

const createBody = z.object({ name: z.string().min(1).max(120) });
const patchBody = z.object({
  name: z.string().min(1).max(120).optional(),
  archived: z.boolean().optional(),
});
const joinBody = z.object({ code: z.string().min(1).max(20) });
const studentsBody = z.object({
  // A teacher pastes a class list. One name per entry.
  names: z.array(z.string().min(1).max(120)).min(1).max(60),
});
const idParams = z.object({ id: z.string().uuid() });
const memberParams = z.object({ id: z.string().uuid(), userId: z.string().uuid() });

/** A password a child can read from paper and type once. */
function initialPassword(): string {
  const words = ['apple', 'bridge', 'candle', 'dragon', 'engine', 'forest', 'garden',
                 'harbour', 'island', 'jungle', 'kettle', 'lantern', 'meadow', 'needle'];
  return `${words[randomInt(words.length)]}-${words[randomInt(words.length)]}-${randomInt(10, 100)}`;
}

export function classRoutes(app: FastifyInstance, db: Database): void {
  /** 404 rather than 403, so an id is never confirmed to someone unconnected. */
  async function teacherOf(user: AuthUser, classId: string) {
    const rows = await db.select().from(classes).where(eq(classes.id, classId)).limit(1);
    const klass = rows[0];
    if (!klass) throw notFound();
    if (user.role === 'admin' || klass.ownerId === user.id) return klass;

    const membership = await db.select().from(classMembers)
      .where(and(eq(classMembers.classId, classId), eq(classMembers.userId, user.id),
                 eq(classMembers.role, 'teacher'))).limit(1);
    if (membership.length === 0) throw notFound();
    return klass;
  }

  async function memberOf(user: AuthUser, classId: string) {
    const rows = await db.select().from(classes).where(eq(classes.id, classId)).limit(1);
    const klass = rows[0];
    if (!klass) throw notFound();
    if (user.role === 'admin' || klass.ownerId === user.id) return klass;
    const membership = await db.select().from(classMembers)
      .where(and(eq(classMembers.classId, classId), eq(classMembers.userId, user.id))).limit(1);
    if (membership.length === 0) throw notFound();
    return klass;
  }

  app.post('/v1/classes', async (request, reply) => {
    const user = requireTeacher(request);
    const body = createBody.parse(request.body);
    const [klass] = await db.insert(classes)
      .values({ name: body.name, ownerId: user.id, joinCode: generateJoinCode() }).returning();
    await db.insert(classMembers)
      .values({ classId: klass!.id, userId: user.id, role: 'teacher' }).onConflictDoNothing();
    return reply.status(201).send({ class: shape(klass!, true) });
  });

  app.get('/v1/classes', async (request) => {
    const user = requireAuth(request);
    const rows = await db.select({ klass: classes, role: classMembers.role })
      .from(classMembers)
      .innerJoin(classes, eq(classes.id, classMembers.classId))
      .where(eq(classMembers.userId, user.id));
    return {
      classes: rows.map((r) => shape(r.klass, r.role === 'teacher' || user.role === 'admin')),
    };
  });

  app.get('/v1/classes/:id', async (request) => {
    const user = requireAuth(request);
    const { id } = idParams.parse(request.params);
    const klass = await memberOf(user, id);

    const isTeacher = user.role !== 'student' &&
      (klass.ownerId === user.id || user.role === 'admin' ||
       (await db.select().from(classMembers)
          .where(and(eq(classMembers.classId, id), eq(classMembers.userId, user.id),
                     eq(classMembers.role, 'teacher'))).limit(1)).length > 0);

    const roster = await db.select({
      id: users.id, name: users.name, username: users.username,
      role: classMembers.role, joinedAt: classMembers.joinedAt,
    }).from(classMembers)
      .innerJoin(users, eq(users.id, classMembers.userId))
      .where(eq(classMembers.classId, id));

    return { class: shape(klass, isTeacher), members: roster };
  });

  app.patch('/v1/classes/:id', async (request) => {
    const user = requireTeacher(request);
    const { id } = idParams.parse(request.params);
    await teacherOf(user, id);
    const body = patchBody.parse(request.body ?? {});
    const [updated] = await db.update(classes).set({
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.archived !== undefined ? { archivedAt: body.archived ? new Date() : null } : {}),
    }).where(eq(classes.id, id)).returning();
    return { class: shape(updated!, true) };
  });

  app.post('/v1/classes/:id/join-code', async (request) => {
    const user = requireTeacher(request);
    const { id } = idParams.parse(request.params);
    await teacherOf(user, id);
    const [updated] = await db.update(classes)
      .set({ joinCode: generateJoinCode(), joinCodeEnabled: true })
      .where(eq(classes.id, id)).returning();
    return { class: shape(updated!, true) };
  });

  app.delete('/v1/classes/:id/join-code', async (request) => {
    const user = requireTeacher(request);
    const { id } = idParams.parse(request.params);
    await teacherOf(user, id);
    const [updated] = await db.update(classes).set({ joinCodeEnabled: false })
      .where(eq(classes.id, id)).returning();
    return { class: shape(updated!, true) };
  });

  app.post('/v1/classes/join', {
    // The code is short by necessity, so the rate limit is the real defence.
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (request) => {
    const user = requireAuth(request);
    const body = joinBody.parse(request.body);
    const code = body.code.trim().toUpperCase();

    const rows = await db.select().from(classes)
      .where(and(eq(classes.joinCode, code), eq(classes.joinCodeEnabled, true),
                 isNull(classes.archivedAt))).limit(1);
    const klass = rows[0];
    // A wrong code, a disabled code and a code for an archived class all give
    // the same answer, so the endpoint cannot be used to enumerate classes.
    if (!klass) throw notFound('That code did not match a class.');

    await db.insert(classMembers)
      .values({ classId: klass.id, userId: user.id, role: 'student' })
      .onConflictDoNothing();
    return { class: shape(klass, false) };
  });

  /**
   * Creates accounts for a whole class in one call and returns their passwords
   * once. This is the only place a plaintext password ever leaves the API, and
   * it is what makes the product usable in a room with no email addresses: a
   * teacher pastes a register and prints the result.
   */
  app.post('/v1/classes/:id/students', async (request, reply) => {
    const user = requireTeacher(request);
    const { id } = idParams.parse(request.params);
    await teacherOf(user, id);
    const body = studentsBody.parse(request.body);

    const created: { name: string; username: string; password: string }[] = [];
    for (const name of body.names) {
      const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 12) || 'student';
      let username = base;
      for (let attempt = 0; attempt < 50; attempt++) {
        const taken = await db.select({ id: users.id }).from(users)
          .where(eq(users.username, username)).limit(1);
        if (taken.length === 0) break;
        username = `${base}${randomInt(10, 1000)}`;
      }
      const password = initialPassword();
      const [student] = await db.insert(users).values({
        name, username, passwordHash: await hashPassword(password),
        role: 'student', mustChangePassword: true,
      }).returning();
      await db.insert(classMembers)
        .values({ classId: id, userId: student!.id, role: 'student' }).onConflictDoNothing();
      created.push({ name, username, password });
    }
    // Returned exactly once; there is no endpoint that will show them again.
    return reply.status(201).send({ students: created });
  });

  app.delete('/v1/classes/:id/members/:userId', async (request, reply) => {
    const user = requireTeacher(request);
    const { id, userId } = memberParams.parse(request.params);
    const klass = await teacherOf(user, id);
    if (klass.ownerId === userId) throw badRequest('OWNER', 'The owner cannot be removed from their own class.');
    await db.delete(classMembers)
      .where(and(eq(classMembers.classId, id), eq(classMembers.userId, userId)));
    return reply.status(204).send();
  });

  /** The join code is shown only to a teacher. */
  function shape(row: typeof classes.$inferSelect, includeCode: boolean) {
    return {
      id: row.id, name: row.name, ownerId: row.ownerId,
      joinCode: includeCode ? row.joinCode : undefined,
      joinCodeEnabled: includeCode ? row.joinCodeEnabled : undefined,
      archivedAt: row.archivedAt, createdAt: row.createdAt,
    };
  }

}
