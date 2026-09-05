import type { FastifyInstance } from 'fastify';
import { ping, type Database } from '@fledge/db';

export function healthRoutes(app: FastifyInstance, db: Database): void {
  // Liveness must never touch the database: a database that is briefly down
  // should not cause the orchestrator to kill an otherwise healthy process.
  app.get('/health', async () => ({ status: 'ok' }));

  app.get('/ready', async (_request, reply) => {
    try { await ping(db); return { status: 'ready' }; }
    catch { return reply.status(503).send({ status: 'unready', reason: 'database' }); }
  });
}
