import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { users } from '@fledge/db';
import { createHarness, login, TEST_ADMIN, type Harness } from '../testing/harness.ts';
import { hashPassword } from '../auth/password.ts';

let h: Harness;
beforeEach(async () => { h = await createHarness(); });
afterEach(async () => { await h.close(); });

describe('authentication', () => {
  it('creates the first administrator from the environment', async () => {
    const cookie = await login(h.app, TEST_ADMIN.email, TEST_ADMIN.password);
    const me = await h.app.inject({ method: 'GET', url: '/v1/auth/me', headers: { cookie } });
    expect(me.json().user.role).toBe('admin');
  });

  it('signs a student in by username, with no email at all', async () => {
    await h.db.insert(users).values({
      name: 'Pupil', username: 'pupil01', passwordHash: await hashPassword('school bus zebra'),
    });
    const cookie = await login(h.app, 'pupil01', 'school bus zebra');
    const me = await h.app.inject({ method: 'GET', url: '/v1/auth/me', headers: { cookie } });
    expect(me.json().user.username).toBe('pupil01');
    expect(me.json().user.email).toBeNull();
  });

  it('gives the same answer for a wrong password and an unknown account', async () => {
    // Otherwise the response tells an attacker which usernames exist, and in a
    // school those are guessable by construction.
    const unknown = await h.app.inject({
      method: 'POST', url: '/v1/auth/login', payload: { identifier: 'nobody@example.org', password: 'x' },
    });
    const wrong = await h.app.inject({
      method: 'POST', url: '/v1/auth/login', payload: { identifier: TEST_ADMIN.email, password: 'wrong' },
    });
    expect(unknown.statusCode).toBe(401);
    expect(wrong.statusCode).toBe(401);
    expect(unknown.json()).toEqual(wrong.json());
  });

  it('refuses a disabled account on its very next request', async () => {
    const cookie = await login(h.app, TEST_ADMIN.email, TEST_ADMIN.password);
    await h.db.update(users).set({ isActive: false }).where(eq(users.email, TEST_ADMIN.email));
    const me = await h.app.inject({ method: 'GET', url: '/v1/auth/me', headers: { cookie } });
    expect(me.statusCode).toBe(401);
  });

  it('makes logging out revoke the session immediately', async () => {
    const cookie = await login(h.app, TEST_ADMIN.email, TEST_ADMIN.password);
    await h.app.inject({ method: 'POST', url: '/v1/auth/logout', headers: { cookie } });
    const me = await h.app.inject({ method: 'GET', url: '/v1/auth/me', headers: { cookie } });
    expect(me.statusCode).toBe(401);
  });

  it('ends every session when the password changes', async () => {
    // Including sessions somebody else may be holding, which is the point.
    const first = await login(h.app, TEST_ADMIN.email, TEST_ADMIN.password);
    const second = await login(h.app, TEST_ADMIN.email, TEST_ADMIN.password);
    const changed = await h.app.inject({
      method: 'POST', url: '/v1/auth/password', headers: { cookie: first },
      payload: { currentPassword: TEST_ADMIN.password, newPassword: 'a much longer replacement' },
    });
    expect(changed.statusCode).toBe(204);
    for (const cookie of [first, second]) {
      const me = await h.app.inject({ method: 'GET', url: '/v1/auth/me', headers: { cookie } });
      expect(me.statusCode).toBe(401);
    }
  });

  it('refuses a password shorter than the configured minimum', async () => {
    const cookie = await login(h.app, TEST_ADMIN.email, TEST_ADMIN.password);
    const response = await h.app.inject({
      method: 'POST', url: '/v1/auth/password', headers: { cookie },
      payload: { currentPassword: TEST_ADMIN.password, newPassword: 'short' },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('WEAK_PASSWORD');
  });

  it('reports liveness without touching the database', async () => {
    const response = await h.app.inject({ method: 'GET', url: '/health' });
    expect(response.json()).toEqual({ status: 'ok' });
  });
});
