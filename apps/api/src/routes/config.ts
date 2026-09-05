import type { FastifyInstance } from 'fastify';
import type { Env } from '../env.ts';

/**
 * What the browser needs to know about this instance.
 *
 * Served at run time rather than baked in at build time, so an operator can
 * move the sandbox to another host by changing an environment variable and
 * restarting, instead of rebuilding the front end. Self-hosters should not
 * need a toolchain to change an address.
 */
export function configRoutes(app: FastifyInstance, env: Env): void {
  app.get('/v1/config', async () => ({
    sandboxUrl: env.SANDBOX_URL,
    publicUrl: env.PUBLIC_URL,
    allowMicropip: env.ALLOW_MICROPIP === 'true',
  }));
}
