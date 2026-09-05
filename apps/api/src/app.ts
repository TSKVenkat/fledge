import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import type { Database } from '@fledge/db';
import { type Env, webOrigins } from './env.ts';
import { registerErrorHandler } from './errors.ts';
import { registerAuthContext } from './auth/guards.ts';
import { healthRoutes } from './routes/health.ts';
import { authRoutes } from './routes/auth.ts';
import { projectRoutes } from './routes/projects.ts';

export async function buildApp(env: Env, db: Database): Promise<FastifyInstance> {
  const app = Fastify({
    logger: env.NODE_ENV !== 'test',
    // This is a control plane. Project contents arrive as JSON and are capped
    // far below this by the project size limits.
    bodyLimit: 4 * 1024 * 1024,
  });

  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, { origin: webOrigins(env), credentials: true });
  await app.register(cookie, { secret: env.SECRET_KEY });
  await app.register(rateLimit, { max: 300, timeWindow: '1 minute' });

  registerErrorHandler(app);
  registerAuthContext(app, db);

  healthRoutes(app, db);
  authRoutes(app, db, env);
  projectRoutes(app, db, env);

  return app;
}
