import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, eq, isNull } from 'drizzle-orm';
import {
  assignments, classMembers, classes, projectFiles, projects, submissions, users, type Database,
} from '@fledge/db';
import { badRequest, notFound } from '../errors.ts';
import { requireAuth, requireTeacher } from '../auth/guards.ts';
import type { AuthUser } from '../auth/sessions.ts';

const createBody = z.object({
  title: z.string().min(1).max(200),
  instructions: z.string().max(20_000).default(''),
  templateProjectId: z.string().uuid(),
  dueAt: z.coerce.date().optional(),
});
const patchBody = z.object({
  title: z.string().min(1).max(200).optional(),
  instructions: z.string().max(20_000).optional(),
  dueAt: z.coerce.date().nullable().optional(),
  published: z.boolean().optional(),
});
const idParams = z.object({ id: z.string().uuid() });

export function assignmentRoutes(app: FastifyInstance, db: Database): void {
  async function teacherOfClass(user: AuthUser, classId: string): Promise<boolean> {
    const rows = await db.select().from(classes).where(eq(classes.id, classId)).limit(1);
    const klass = rows[0];
    if (!klass) return false;
    if (user.role === 'admin' || klass.ownerId === user.id) return true;
    const membership = await db.select().from(classMembers)
      .where(and(eq(classMembers.classId, classId), eq(classMembers.userId, user.id),
                 eq(classMembers.role, 'teacher'))).limit(1);
    return membership.length > 0;
  }

  async function loadAssignment(user: AuthUser, id: string) {
    const rows = await db.select().from(assignments)
      .where(and(eq(assignments.id, id), isNull(assignments.deletedAt))).limit(1);
    const task = rows[0];
    if (!task) throw notFound();

    const isTeacher = await teacherOfClass(user, task.classId);
    if (isTeacher) return { task, isTeacher: true as const };

    const membership = await db.select().from(classMembers)
      .where(and(eq(classMembers.classId, task.classId), eq(classMembers.userId, user.id))).limit(1);
    // A draft is invisible to students entirely; not "forbidden", absent.
    if (membership.length === 0 || task.publishedAt === null) throw notFound();
    return { task, isTeacher: false as const };
  }

  app.post('/v1/classes/:id/assignments', async (request, reply) => {
    const user = requireTeacher(request);
    const { id } = idParams.parse(request.params);
    if (!(await teacherOfClass(user, id))) throw notFound();
    const body = createBody.parse(request.body);

    const template = await db.select().from(projects)
      .where(and(eq(projects.id, body.templateProjectId), isNull(projects.deletedAt))).limit(1);
    if (template.length === 0) throw badRequest('NO_TEMPLATE', 'That starter project does not exist.');

    const [task] = await db.insert(assignments).values({
      classId: id, templateProjectId: body.templateProjectId, title: body.title,
      instructions: body.instructions, dueAt: body.dueAt ?? null, createdBy: user.id,
    }).returning();
    return reply.status(201).send({ assignment: task });
  });

  app.get('/v1/classes/:id/assignments', async (request) => {
    const user = requireAuth(request);
    const { id } = idParams.parse(request.params);
    const isTeacher = await teacherOfClass(user, id);
    if (!isTeacher) {
      const membership = await db.select().from(classMembers)
        .where(and(eq(classMembers.classId, id), eq(classMembers.userId, user.id))).limit(1);
      if (membership.length === 0) throw notFound();
    }
    const rows = await db.select().from(assignments)
      .where(and(eq(assignments.classId, id), isNull(assignments.deletedAt)));
    // Students never see drafts.
    return { assignments: isTeacher ? rows : rows.filter((r) => r.publishedAt !== null) };
  });

  app.get('/v1/assignments/:id', async (request) => {
    const user = requireAuth(request);
    const { id } = idParams.parse(request.params);
    const { task, isTeacher } = await loadAssignment(user, id);

    if (!isTeacher) {
      const mine = await db.select().from(submissions)
        .where(and(eq(submissions.assignmentId, id), eq(submissions.studentId, user.id))).limit(1);
      return { assignment: task, submission: mine[0] ?? null };
    }

    // The grid: every student in the class, with their submission if they have
    // started. A left join would be neater, but the roster is the thing a
    // teacher wants complete -- including the children who have not begun.
    const roster = await db.select({ id: users.id, name: users.name, username: users.username })
      .from(classMembers)
      .innerJoin(users, eq(users.id, classMembers.userId))
      .where(and(eq(classMembers.classId, task.classId), eq(classMembers.role, 'student')));
    const rows = await db.select().from(submissions).where(eq(submissions.assignmentId, id));
    const byStudent = new Map(rows.map((r) => [r.studentId, r]));

    return {
      assignment: task,
      submissions: roster.map((student) => ({
        student,
        submission: byStudent.get(student.id) ?? null,
        state: byStudent.get(student.id)?.state ?? 'not_started',
      })),
    };
  });

  app.patch('/v1/assignments/:id', async (request) => {
    const user = requireTeacher(request);
    const { id } = idParams.parse(request.params);
    const { task, isTeacher } = await loadAssignment(user, id);
    if (!isTeacher) throw notFound();
    const body = patchBody.parse(request.body ?? {});

    const [updated] = await db.update(assignments).set({
      ...(body.title !== undefined ? { title: body.title } : {}),
      ...(body.instructions !== undefined ? { instructions: body.instructions } : {}),
      ...(body.dueAt !== undefined ? { dueAt: body.dueAt } : {}),
      ...(body.published !== undefined
        ? { publishedAt: body.published ? (task.publishedAt ?? new Date()) : null }
        : {}),
    }).where(eq(assignments.id, id)).returning();
    return { assignment: updated };
  });

  /**
   * Get-or-create the student's own copy.
   *
   * Idempotent by construction: the unique constraint on
   * (assignment_id, student_id) means a double click cannot produce two forks,
   * and a child who opens the task on Monday and again on Friday returns to the
   * work they did, not to a blank starter.
   */
  app.post('/v1/assignments/:id/open', async (request) => {
    const user = requireAuth(request);
    const { id } = idParams.parse(request.params);
    const { task } = await loadAssignment(user, id);

    const existing = await db.select().from(submissions)
      .where(and(eq(submissions.assignmentId, id), eq(submissions.studentId, user.id))).limit(1);
    if (existing[0]) return { submission: existing[0], created: false };

    const template = await db.select().from(projects)
      .where(eq(projects.id, task.templateProjectId)).limit(1);
    if (!template[0]) throw badRequest('NO_TEMPLATE', 'That starter project has gone.');
    const files = await db.select().from(projectFiles)
      .where(eq(projectFiles.projectId, task.templateProjectId));

    const [copy] = await db.insert(projects).values({
      ownerId: user.id, classId: task.classId, kind: template[0].kind,
      title: task.title, settings: template[0].settings, forkedFromId: template[0].id,
    }).returning();
    if (files.length > 0) {
      await db.insert(projectFiles).values(files.map((f) => ({
        projectId: copy!.id, path: f.path, content: f.content,
        contentType: f.contentType, sizeBytes: f.sizeBytes,
      })));
    }

    const [submission] = await db.insert(submissions).values({
      assignmentId: id, studentId: user.id, projectId: copy!.id, state: 'in_progress',
    }).onConflictDoNothing().returning();

    // Lost the race with another tab: use whatever won.
    if (!submission) {
      const won = await db.select().from(submissions)
        .where(and(eq(submissions.assignmentId, id), eq(submissions.studentId, user.id))).limit(1);
      await db.delete(projects).where(eq(projects.id, copy!.id));
      return { submission: won[0]!, created: false };
    }
    return { submission, created: true };
  });

  app.post('/v1/submissions/:id/submit', async (request) => {
    const user = requireAuth(request);
    const { id } = idParams.parse(request.params);
    const rows = await db.select().from(submissions).where(eq(submissions.id, id)).limit(1);
    const submission = rows[0];
    if (!submission || submission.studentId !== user.id) throw notFound();
    const [updated] = await db.update(submissions)
      .set({ state: 'submitted', submittedAt: new Date() })
      .where(eq(submissions.id, id)).returning();
    return { submission: updated };
  });

  app.post('/v1/submissions/:id/return', async (request) => {
    const user = requireTeacher(request);
    const { id } = idParams.parse(request.params);
    const rows = await db.select({ submission: submissions, assignment: assignments })
      .from(submissions)
      .innerJoin(assignments, eq(assignments.id, submissions.assignmentId))
      .where(eq(submissions.id, id)).limit(1);
    const row = rows[0];
    if (!row || !(await teacherOfClass(user, row.assignment.classId))) throw notFound();
    const [updated] = await db.update(submissions).set({ state: 'returned' })
      .where(eq(submissions.id, id)).returning();
    return { submission: updated };
  });
}
