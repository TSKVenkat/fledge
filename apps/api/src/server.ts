/** Composition root: load config, connect, build, bootstrap, listen. */
import { createDatabase } from '@fledge/db';
import { buildApp } from './app.ts';
import { bootstrapFirstAdmin } from './bootstrap.ts';
import { loadEnv } from './env.ts';
import { deleteExpiredSessions } from './auth/sessions.ts';
import { sweepExpiredProjects } from './routes/projects.ts';

const env = loadEnv();
const { db, close } = createDatabase(env.DATABASE_URL);
const app = await buildApp(env, db);

const bootstrapped = await bootstrapFirstAdmin(db, env);
if (bootstrapped === 'created') app.log.info('created the first administrator');

// There is no job queue: the only recurring work is a sweep, and a timer in
// the process is the whole of what that needs. Add a queue when there is real
// asynchronous work, not before.
const sweep = setInterval(() => {
  void (async () => {
    try {
      await deleteExpiredSessions(db);
      const removed = await sweepExpiredProjects(db);
      if (removed > 0) app.log.info({ removed }, 'swept expired anonymous projects');
    } catch (error) { app.log.error({ err: error }, 'sweep failed'); }
  })();
}, 15 * 60 * 1000);
sweep.unref();

await app.listen({ port: env.PORT, host: '0.0.0.0' });

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void (async () => {
      clearInterval(sweep);
      await app.close();
      await close();
      process.exit(0);
    })();
  });
}
