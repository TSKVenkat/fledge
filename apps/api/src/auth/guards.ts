import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Database } from '@fledge/db';
import { SESSION_COOKIE, resolveSession, type AuthUser } from './sessions.ts';
import { forbidden, notFound, unauthorized } from '../errors.ts';

declare module 'fastify' {
  interface FastifyRequest {
    user: AuthUser | null;
    /** Raw edit token from X-Edit-Token, for anonymous project access. */
    editToken: string | null;
  }
}

/**
 * Resolves the cookie once per request and decorates the request. Handlers
 * never touch cookies themselves.
 */
export function registerAuthContext(app: FastifyInstance, db: Database): void {
  app.decorateRequest('user', null);
  app.decorateRequest('editToken', null);
  app.addHook('onRequest', async (request) => {
    const token = request.cookies[SESSION_COOKIE];
    request.user = token ? await resolveSession(db, token) : null;
    const header = request.headers['x-edit-token'];
    request.editToken = typeof header === 'string' && header.length > 0 ? header : null;
  });
}

export function requireAuth(request: FastifyRequest): AuthUser {
  if (!request.user) throw unauthorized();
  return request.user;
}

export function requireAdmin(request: FastifyRequest): AuthUser {
  const user = requireAuth(request);
  if (user.role !== 'admin') throw forbidden();
  return user;
}

export function requireTeacher(request: FastifyRequest): AuthUser {
  const user = requireAuth(request);
  if (user.role === 'student') throw forbidden();
  return user;
}

/**
 * The one place ownership is decided.
 *
 * Returns 404 rather than 403 when the caller has no business with the object,
 * so the API does not confirm that an id exists to someone who should not know.
 */
export function requireOwnerOrAdmin(user: AuthUser | null, ownerId: string | null): void {
  if (!user) throw notFound();
  if (user.role === 'admin') return;
  if (ownerId === null || ownerId !== user.id) throw notFound();
}
