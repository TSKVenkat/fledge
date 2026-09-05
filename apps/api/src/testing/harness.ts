/**
 * A real application over an in-process database.
 *
 * No ports, no containers, no Docker: an integration test costs about what a
 * unit test does, which is what makes it reasonable to write one for every
 * route rather than only for the interesting ones.
 */
import { reset, testDatabase } from '@fledge/db/testing';
import type { Database } from '@fledge/db';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.ts';
import { loadEnv, type Env } from '../env.ts';
import { bootstrapFirstAdmin } from '../bootstrap.ts';

export const TEST_ADMIN = { email: 'admin@example.org', password: 'correct horse battery' };

export interface Harness {
  app: FastifyInstance;
  db: Database;
  env: Env;
  close(): Promise<void>;
}

export async function createHarness(): Promise<Harness> {
  const db = await testDatabase();
  await reset(db);

  const env = loadEnv({
    NODE_ENV: 'test',
    DATABASE_URL: 'postgres://unused',
    SECRET_KEY: Buffer.alloc(32, 7).toString('base64'),
    ADMIN_EMAIL: TEST_ADMIN.email,
    ADMIN_PASSWORD: TEST_ADMIN.password,
  } as NodeJS.ProcessEnv);

  const app = await buildApp(env, db);
  await bootstrapFirstAdmin(db, env);
  return { app, db, env, close: async () => { await app.close(); } };
}

/** Signs in and returns the cookie header a subsequent request should send. */
export async function login(app: FastifyInstance, identifier: string, password: string): Promise<string> {
  const response = await app.inject({
    method: 'POST', url: '/v1/auth/login', payload: { identifier, password },
  });
  const cookie = response.cookies.find((c) => c.name === 'fledge_session');
  if (!cookie) throw new Error(`login failed: ${response.statusCode} ${response.body}`);
  return `fledge_session=${cookie.value}`;
}
