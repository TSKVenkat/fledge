import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createHash, randomBytes } from 'node:crypto';
import { and, desc, eq, isNull, lt, sql } from 'drizzle-orm';
import { projectFiles, projects, type Database } from '@fledge/db';
import type { Env } from '../env.ts';
import { badRequest, notFound, tooLarge } from '../errors.ts';
import { seal } from '../crypto.ts';

/** Whole-project limits, enforced here so the database is never asked to hold
 *  something a browser could not open anyway. */
const MAX_FILE_BYTES = 512 * 1024;
const MAX_FILES = 64;
const MAX_PROJECT_BYTES = 2 * 1024 * 1024;
/** How long an anonymous project survives without being opened. */
const ANONYMOUS_TTL_DAYS = 30;

const pathRule = z.string()
  .min(1).max(200)
  .regex(/^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/, 'Use letters, numbers, dots, dashes and slashes.')
  .refine((p) => !p.split('/').includes('..'), 'Paths cannot go up a directory.')
  .refine((p) => !p.startsWith('/'), 'Paths cannot start with a slash.');

const createBody = z.object({
  title: z.string().min(1).max(200).optional(),
  kind: z.enum(['python', 'web']).optional(),
  files: z.record(pathRule, z.string()).optional(),
  entry: pathRule.optional(),
});
const filesBody = z.object({ files: z.record(pathRule, z.string()) });
const patchBody = z.object({
  title: z.string().min(1).max(200).optional(),
  entry: pathRule.optional(),
});
const idParams = z.object({ id: z.string().uuid() });

const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');

export function projectRoutes(app: FastifyInstance, db: Database, env: Env): void {
  /**
   * Access is either a signed-in owner or the bearer of the project's edit
   * token. The token is how "type something, close the tab, come back
   * tomorrow" works without an account, and it uses the same construction as a
   * share link: random bytes, looked up by hash, sealed so it can be shown
   * again.
   */
  async function loadProject(request: { user: { id: string; role: string } | null; editToken: string | null }, id: string) {
    const rows = await db.select().from(projects)
      .where(and(eq(projects.id, id), isNull(projects.deletedAt))).limit(1);
    const project = rows[0];
    if (!project) throw notFound('That project is not available.');

    const isOwner = request.user !== null && project.ownerId === request.user.id;
    const isAdmin = request.user?.role === 'admin';
    const hasToken = request.editToken !== null && project.editTokenHash === tokenHash(request.editToken);
    // A missing project and one belonging to somebody else look identical.
    if (!isOwner && !isAdmin && !hasToken) throw notFound('That project is not available.');
    return project;
  }

  function checkSize(files: Record<string, string>): void {
    const entries = Object.entries(files);
    if (entries.length > MAX_FILES) throw tooLarge(`A project can hold ${MAX_FILES} files.`);
    let total = 0;
    for (const [path, content] of entries) {
      const bytes = Buffer.byteLength(content, 'utf8');
      if (bytes > MAX_FILE_BYTES) throw tooLarge(`${path} is larger than ${MAX_FILE_BYTES / 1024} KB.`);
      total += bytes;
    }
    if (total > MAX_PROJECT_BYTES) throw tooLarge('That project is larger than 2 MB in total.');
  }

  app.post('/v1/projects', async (request, reply) => {
    const body = createBody.parse(request.body ?? {});
    const files = body.files ?? { 'main.py': '' };
    checkSize(files);

    const anonymous = request.user === null;
    const token = anonymous ? randomBytes(32).toString('base64url') : null;
    const sealed = token ? seal(token, env.SECRET_KEY) : null;

    const [project] = await db.insert(projects).values({
      ownerId: request.user?.id ?? null,
      title: body.title ?? 'Untitled',
      kind: body.kind ?? 'python',
      settings: { entry: body.entry ?? 'main.py' },
      editTokenHash: token ? tokenHash(token) : null,
      editTokenCt: sealed?.ct ?? null,
      editTokenIv: sealed?.iv ?? null,
      editTokenTag: sealed?.tag ?? null,
      expiresAt: anonymous ? new Date(Date.now() + ANONYMOUS_TTL_DAYS * 86_400_000) : null,
    }).returning();

    await writeFiles(db, project!.id, files);
    return reply.status(201).send({ project: publicShape(project!), editToken: token ?? undefined });
  });

  app.get('/v1/projects', async (request) => {
    const user = request.user;
    if (!user) return { projects: [] };
    const rows = await db.select().from(projects)
      .where(and(eq(projects.ownerId, user.id), isNull(projects.deletedAt)))
      .orderBy(desc(projects.createdAt)).limit(100);
    return { projects: rows.map(publicShape) };
  });

  app.get('/v1/projects/:id', async (request) => {
    const { id } = idParams.parse(request.params);
    const project = await loadProject(request, id);
    const files = await db.select().from(projectFiles).where(eq(projectFiles.projectId, id));
    return {
      project: publicShape(project),
      files: Object.fromEntries(files.map((f) => [f.path, f.content ?? ''])),
    };
  });

  app.patch('/v1/projects/:id', async (request) => {
    const { id } = idParams.parse(request.params);
    const project = await loadProject(request, id);
    const body = patchBody.parse(request.body ?? {});
    const settings = { ...(project.settings as Record<string, unknown>), ...(body.entry ? { entry: body.entry } : {}) };
    const [updated] = await db.update(projects).set({
      ...(body.title !== undefined ? { title: body.title } : {}),
      settings, updatedAt: new Date(),
    }).where(eq(projects.id, id)).returning();
    return { project: publicShape(updated!) };
  });

  app.put('/v1/projects/:id/files', async (request) => {
    const { id } = idParams.parse(request.params);
    const project = await loadProject(request, id);
    const body = filesBody.parse(request.body);
    if (Object.keys(body.files).length === 0) throw badRequest('EMPTY_PROJECT', 'A project needs at least one file.');
    checkSize(body.files);

    // Replaced wholesale in one transaction: the editor always holds the entire
    // set, and a partial write would leave a project that cannot run.
    await db.transaction(async (tx) => {
      await tx.delete(projectFiles).where(eq(projectFiles.projectId, id));
      await writeFiles(tx as unknown as Database, id, body.files);
      await tx.update(projects).set({ updatedAt: new Date() }).where(eq(projects.id, id));
    });
    return { project: publicShape(project) };
  });

  app.delete('/v1/projects/:id', async (request, reply) => {
    const { id } = idParams.parse(request.params);
    await loadProject(request, id);
    await db.update(projects).set({ deletedAt: new Date() }).where(eq(projects.id, id));
    return reply.status(204).send();
  });

  /** Attaches an anonymous project to the account that is now signed in. */
  app.post('/v1/projects/:id/claim', async (request) => {
    const { id } = idParams.parse(request.params);
    const user = request.user;
    if (!user) throw notFound('That project is not available.');
    const project = await loadProject(request, id);
    if (project.ownerId !== null) throw badRequest('ALREADY_OWNED', 'That project already belongs to an account.');

    const [updated] = await db.update(projects)
      .set({ ownerId: user.id, editTokenHash: null, editTokenCt: null, editTokenIv: null,
             editTokenTag: null, expiresAt: null, updatedAt: new Date() })
      .where(eq(projects.id, id)).returning();
    return { project: publicShape(updated!) };
  });
}

async function writeFiles(db: Database, projectId: string, files: Record<string, string>): Promise<void> {
  const rows = Object.entries(files).map(([path, content]) => ({
    projectId, path, content,
    contentType: path.endsWith('.py') ? 'text/x-python'
      : path.endsWith('.html') ? 'text/html'
      : path.endsWith('.css') ? 'text/css'
      : path.endsWith('.js') ? 'text/javascript' : 'text/plain',
    sizeBytes: Buffer.byteLength(content, 'utf8'),
  }));
  if (rows.length > 0) await db.insert(projectFiles).values(rows);
}

/** Never returns the token hash or ciphertext. */
function publicShape(row: typeof projects.$inferSelect) {
  return {
    id: row.id, title: row.title, kind: row.kind, settings: row.settings,
    ownerId: row.ownerId, createdAt: row.createdAt, updatedAt: row.updatedAt,
    anonymous: row.ownerId === null,
  };
}

/** Removes anonymous projects nobody came back for. */
export async function sweepExpiredProjects(db: Database): Promise<number> {
  const removed = await db.delete(projects)
    .where(and(sql`${projects.expiresAt} is not null`, lt(projects.expiresAt, new Date())))
    .returning({ id: projects.id });
  return removed.length;
}
