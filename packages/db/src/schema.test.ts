import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { testDatabase, reset } from './testing.ts';
import { users, classes, classMembers, projects, projectFiles, submissions, assignments } from './schema.ts';
import type { Database } from './client.ts';

let db: Database;
beforeAll(async () => { db = await testDatabase(); });
beforeEach(async () => { await reset(db); });

const admin = () => db.insert(users).values({
  name: 'Ada', email: 'ada@example.org', passwordHash: 'x', role: 'admin',
}).returning();

describe('schema', () => {
  it('applies the real migrations to an empty database', async () => {
    const rows = await db.execute(sql`select tablename from pg_tables where schemaname = 'public'`);
    const names = (rows as unknown as { rows: { tablename: string }[] }).rows.map((r) => r.tablename);
    for (const t of ['users', 'sessions', 'classes', 'class_members', 'projects',
                     'project_files', 'share_links', 'assignments', 'submissions']) {
      expect(names).toContain(t);
    }
  });

  it('accepts a user with only a username, and one with only an email', async () => {
    // A child needs neither a mailbox nor a parent's address to learn to code.
    await db.insert(users).values({ name: 'Pupil', username: 'pupil01', passwordHash: 'x' });
    await db.insert(users).values({ name: 'Teacher', email: 't@example.org', passwordHash: 'x' });
    expect(await db.select().from(users)).toHaveLength(2);
  });

  it('refuses a user with neither an email nor a username', async () => {
    // Drizzle wraps the driver error, so the constraint name is on the cause
    // rather than the message. Assert on both: that it was refused at all, and
    // that it was refused by the constraint we meant rather than by accident.
    const attempt = db.insert(users).values({ name: 'Nobody', passwordHash: 'x' });
    await expect(attempt).rejects.toThrow();
    const error = await attempt.catch((e: unknown) => e) as { cause?: { message?: string } };
    expect(String(error.cause?.message ?? '')).toMatch(/users_identifier/);
  });

  it('allows many users without an email, despite the unique index', async () => {
    // The index is partial; without that, the second null collides.
    await db.insert(users).values({ name: 'A', username: 'a', passwordHash: 'x' });
    await db.insert(users).values({ name: 'B', username: 'b', passwordHash: 'x' });
    expect(await db.select().from(users)).toHaveLength(2);
  });

  it('makes a duplicate class join code impossible', async () => {
    const [owner] = await admin();
    await db.insert(classes).values({ name: '7B', ownerId: owner!.id, joinCode: 'KRTVXQ2' });
    await expect(db.insert(classes).values({ name: '8A', ownerId: owner!.id, joinCode: 'KRTVXQ2' }))
      .rejects.toThrow();
  });

  it('makes joining a class twice a no-op rather than a duplicate row', async () => {
    const [owner] = await admin();
    const [klass] = await db.insert(classes).values({ name: '7B', ownerId: owner!.id, joinCode: 'AAA1111' }).returning();
    const join = () => db.insert(classMembers)
      .values({ classId: klass!.id, userId: owner!.id, role: 'student' })
      .onConflictDoNothing();
    await join(); await join();
    expect(await db.select().from(classMembers)).toHaveLength(1);
  });

  it('cannot give one student two forks of the same assignment', async () => {
    // The constraint is the idempotency mechanism for "open assignment".
    const [teacher] = await admin();
    const [klass] = await db.insert(classes).values({ name: '9C', ownerId: teacher!.id, joinCode: 'BBB2222' }).returning();
    const [tpl] = await db.insert(projects).values({ ownerId: teacher!.id, title: 'Starter' }).returning();
    const [task] = await db.insert(assignments).values({
      classId: klass!.id, templateProjectId: tpl!.id, title: 'Loops',
    }).returning();
    const [fork] = await db.insert(projects).values({ ownerId: teacher!.id, title: 'Loops (copy)' }).returning();

    await db.insert(submissions).values({ assignmentId: task!.id, studentId: teacher!.id, projectId: fork!.id });
    await expect(db.insert(submissions)
      .values({ assignmentId: task!.id, studentId: teacher!.id, projectId: fork!.id }))
      .rejects.toThrow();
  });

  it('removes a project’s files when the project goes', async () => {
    const [owner] = await admin();
    const [p] = await db.insert(projects).values({ ownerId: owner!.id }).returning();
    await db.insert(projectFiles).values({ projectId: p!.id, path: 'main.py', content: 'print(1)', sizeBytes: 8 });
    await db.delete(projects).where(eq(projects.id, p!.id));
    expect(await db.select().from(projectFiles)).toHaveLength(0);
  });

  it('keeps an anonymous project when its owner column is null', async () => {
    const [p] = await db.insert(projects).values({ title: 'Scratch', editTokenHash: 'deadbeef' }).returning();
    expect(p!.ownerId).toBeNull();
  });
});
