import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createHash, randomBytes } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import { projectFiles, projects, shareLinks, type Database } from '@fledge/db';
import type { Env } from '../env.ts';
import { forbidden, notFound } from '../errors.ts';
import { open, seal, sign, verify } from '../crypto.ts';
import { hashPassword, verifyPassword } from '../auth/password.ts';
import { requireOwnerOrAdmin } from '../auth/guards.ts';
import type { AuthUser } from '../auth/sessions.ts';

const UNLOCK_TTL_MS = 12 * 60 * 60 * 1000;

const createBody = z.object({
  visibility: z.enum(['link', 'password', 'authenticated']).default('link'),
  password: z.string().min(1).max(200).optional(),
  allowFork: z.boolean().default(true),
  allowEmbed: z.boolean().default(true),
  expiresAt: z.coerce.date().optional(),
});
const idParams = z.object({ id: z.string().uuid() });
const tokenParams = z.object({ token: z.string().min(20).max(100) });
const unlockBody = z.object({ password: z.string().min(1).max(200) });

const hashOf = (token: string) => createHash('sha256').update(token).digest('hex');

/** Signed rather than stored: it grants nothing except access to one share the
 *  holder already had the password for, and a row per unlock is a table that
 *  only ever grows. */
const unlockCookieName = (shareId: string) => `fledge_share_${shareId.replace(/-/g, '')}`;
const signUnlock = (shareId: string, expiresAt: number, secret: string) =>
  `${expiresAt}.${sign(`${shareId}:${expiresAt}`, secret)}`;

function unlockValid(cookie: string | undefined, shareId: string, secret: string): boolean {
  if (!cookie) return false;
  const [expiry, signature] = cookie.split('.');
  if (!expiry || !signature) return false;
  const expiresAt = Number(expiry);
  if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) return false;
  return verify(`${shareId}:${expiresAt}`, signature, secret);
}

export function shareRoutes(app: FastifyInstance, db: Database, env: Env): void {
  async function ownedProject(request: { user: AuthUser | null }, projectId: string) {
    const rows = await db.select().from(projects)
      .where(and(eq(projects.id, projectId), isNull(projects.deletedAt))).limit(1);
    const project = rows[0];
    if (!project) throw notFound();
    requireOwnerOrAdmin(request.user, project.ownerId);
    return project;
  }

  app.post('/v1/projects/:id/shares', async (request, reply) => {
    const { id } = idParams.parse(request.params);
    await ownedProject(request, id);
    const body = createBody.parse(request.body ?? {});

    const token = randomBytes(32).toString('base64url');
    const sealed = seal(token, env.SECRET_KEY);
    const [share] = await db.insert(shareLinks).values({
      projectId: id,
      tokenHash: hashOf(token),
      tokenCt: sealed.ct, tokenIv: sealed.iv, tokenTag: sealed.tag,
      visibility: body.visibility,
      passwordHash: body.password ? await hashPassword(body.password) : null,
      allowFork: body.allowFork,
      allowEmbed: body.allowEmbed,
      expiresAt: body.expiresAt ?? null,
      createdBy: request.user?.id ?? null,
    }).returning();

    return reply.status(201).send({ share: publicShare(share!, token) });
  });

  app.get('/v1/projects/:id/shares', async (request) => {
    const { id } = idParams.parse(request.params);
    await ownedProject(request, id);
    const rows = await db.select().from(shareLinks).where(eq(shareLinks.projectId, id));
    return {
      shares: rows.map((row) => publicShare(
        row,
        // Shown again from the sealed copy, never from storage in the clear.
        open({ ct: row.tokenCt, iv: row.tokenIv, tag: row.tokenTag }, env.SECRET_KEY) ?? undefined,
      )),
    };
  });

  app.delete('/v1/shares/:id', async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const rows = await db.select().from(shareLinks).where(eq(shareLinks.id, id)).limit(1);
    const share = rows[0];
    if (!share) throw notFound();
    await ownedProject(request, share.projectId);
    // Revoked rather than deleted, so a link that stopped working can be
    // explained rather than merely vanishing.
    await db.update(shareLinks).set({ revokedAt: new Date() }).where(eq(shareLinks.id, id));
    return reply.status(204).send();
  });

  app.get('/v1/shares/:token', {
    config: { rateLimit: { max: 120, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const { token } = tokenParams.parse(request.params);
    const rows = await db.select({ share: shareLinks, project: projects })
      .from(shareLinks)
      .innerJoin(projects, eq(projects.id, shareLinks.projectId))
      .where(eq(shareLinks.tokenHash, hashOf(token))).limit(1);
    const row = rows[0];

    // Revoked, expired, deleted and never-existed all look the same from
    // outside, so a dead link cannot be used to learn which projects exist.
    if (!row || row.share.revokedAt || row.project.deletedAt ||
        (row.share.expiresAt && row.share.expiresAt < new Date())) {
      throw notFound('That link is not available.');
    }

    if (row.share.visibility === 'authenticated' && !request.user) {
      throw forbidden('Sign in to open this.');
    }
    if (row.share.visibility === 'password') {
      const cookie = request.cookies[unlockCookieName(row.share.id)];
      if (!unlockValid(cookie, row.share.id, env.SECRET_KEY)) {
        // A distinct code, so the page can ask for the password rather than
        // treating this as a dead link.
        return reply.status(403).send({
          error: { code: 'PASSWORD_REQUIRED', message: 'This needs a password.', retryable: false },
        });
      }
    }

    const files = await db.select().from(projectFiles).where(eq(projectFiles.projectId, row.project.id));
    return {
      project: { id: row.project.id, title: row.project.title, kind: row.project.kind, settings: row.project.settings },
      share: { allowFork: row.share.allowFork, allowEmbed: row.share.allowEmbed, embedOptions: row.share.embedOptions },
      files: Object.fromEntries(files.map((f) => [f.path, f.content ?? ''])),
    };
  });

  app.post('/v1/shares/:token/unlock', {
    // This is a password prompt open to the internet.
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const { token } = tokenParams.parse(request.params);
    const body = unlockBody.parse(request.body);
    const rows = await db.select().from(shareLinks).where(eq(shareLinks.tokenHash, hashOf(token))).limit(1);
    const share = rows[0];

    // Verified even when nothing matched, so a wrong token and a wrong password
    // are indistinguishable in both time and response.
    const ok = await verifyPassword(body.password, share?.passwordHash ?? null);
    if (!share || !ok || share.revokedAt) throw notFound('That link is not available.');

    const expiresAt = Date.now() + UNLOCK_TTL_MS;
    reply.setCookie(unlockCookieName(share.id), signUnlock(share.id, expiresAt, env.SECRET_KEY), {
      httpOnly: true, sameSite: 'lax', secure: env.NODE_ENV === 'production',
      path: '/', expires: new Date(expiresAt),
    });
    return reply.status(204).send();
  });

  /** Remixing: takes a copy as a fresh anonymous project. */
  app.post('/v1/shares/:token/fork', {
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const { token } = tokenParams.parse(request.params);
    const rows = await db.select({ share: shareLinks, project: projects })
      .from(shareLinks)
      .innerJoin(projects, eq(projects.id, shareLinks.projectId))
      .where(eq(shareLinks.tokenHash, hashOf(token))).limit(1);
    const row = rows[0];
    if (!row || row.share.revokedAt || row.project.deletedAt || !row.share.allowFork) {
      throw notFound('That link is not available.');
    }

    const files = await db.select().from(projectFiles).where(eq(projectFiles.projectId, row.project.id));
    const editToken = request.user ? null : randomBytes(32).toString('base64url');
    const sealed = editToken ? seal(editToken, env.SECRET_KEY) : null;

    const [copy] = await db.insert(projects).values({
      ownerId: request.user?.id ?? null,
      title: `${row.project.title} (copy)`,
      kind: row.project.kind,
      settings: row.project.settings,
      forkedFromId: row.project.id,
      editTokenHash: editToken ? hashOf(editToken) : null,
      editTokenCt: sealed?.ct ?? null, editTokenIv: sealed?.iv ?? null, editTokenTag: sealed?.tag ?? null,
      expiresAt: request.user ? null : new Date(Date.now() + 30 * 86_400_000),
    }).returning();

    if (files.length > 0) {
      await db.insert(projectFiles).values(files.map((f) => ({
        projectId: copy!.id, path: f.path, content: f.content,
        contentType: f.contentType, sizeBytes: f.sizeBytes,
      })));
    }
    return reply.status(201).send({
      project: { id: copy!.id, title: copy!.title, kind: copy!.kind },
      editToken: editToken ?? undefined,
    });
  });
}

/** Never returns the hash or the ciphertext. */
function publicShare(row: typeof shareLinks.$inferSelect, token?: string) {
  return {
    id: row.id, visibility: row.visibility, allowFork: row.allowFork, allowEmbed: row.allowEmbed,
    expiresAt: row.expiresAt, revokedAt: row.revokedAt, createdAt: row.createdAt,
    token, // present only when we can show it: at creation, or from the seal
  };
}
