import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHarness, login, TEST_ADMIN, type Harness } from '../testing/harness.ts';

let h: Harness;
let admin: string;
beforeEach(async () => { h = await createHarness(); admin = await login(h.app, TEST_ADMIN.email, TEST_ADMIN.password); });
afterEach(async () => { await h.close(); });

const create = (payload: object) => h.app.inject({ method: 'POST', url: '/v1/admin/users', headers: { cookie: admin }, payload });

describe('administering users', () => {
  it('lets an administrator create a teacher who must then choose a password', async () => {
    const r = await create({ name: 'Mr Hall', email: 'hall@example.org', password: 'a first password here' });
    expect(r.statusCode).toBe(201);
    expect(r.json().user.role).toBe('teacher');
    expect(r.json().user.mustChangePassword).toBe(true);
    expect(JSON.stringify(r.json())).not.toContain('passwordHash');
    const cookie = await login(h.app, 'hall@example.org', 'a first password here');
    expect((await h.app.inject({ method: 'GET', url: '/v1/auth/me', headers: { cookie } })).statusCode).toBe(200);
  });

  it('refuses a duplicate email with a distinct code', async () => {
    await create({ name: 'A', email: 'dup@example.org', password: 'a first password here' });
    const again = await create({ name: 'B', email: 'DUP@example.org', password: 'a first password here' });
    expect(again.statusCode).toBe(409);
    expect(again.json().error.code).toBe('EMAIL_TAKEN');
  });

  it('is not available to a teacher', async () => {
    await create({ name: 'T', email: 't@example.org', password: 'a first password here' });
    const teacher = await login(h.app, 't@example.org', 'a first password here');
    const r = await h.app.inject({ method: 'GET', url: '/v1/admin/users', headers: { cookie: teacher } });
    expect(r.statusCode).toBe(403);
  });

  it('will not let an administrator disable or demote themselves', async () => {
    const me = (await h.app.inject({ method: 'GET', url: '/v1/auth/me', headers: { cookie: admin } })).json().user;
    for (const payload of [{ isActive: false }, { role: 'teacher' }]) {
      const r = await h.app.inject({ method: 'PATCH', url: `/v1/admin/users/${me.id}`, headers: { cookie: admin }, payload });
      expect(r.statusCode).toBe(400);
      expect(r.json().error.code).toBe('SELF_LOCKOUT');
    }
  });

  it('disabling an account ends its sessions immediately', async () => {
    const { user } = (await create({ name: 'T', email: 't2@example.org', password: 'a first password here' })).json();
    const teacher = await login(h.app, 't2@example.org', 'a first password here');
    await h.app.inject({ method: 'PATCH', url: `/v1/admin/users/${user.id}`, headers: { cookie: admin }, payload: { isActive: false } });
    const me = await h.app.inject({ method: 'GET', url: '/v1/auth/me', headers: { cookie: teacher } });
    expect(me.statusCode).toBe(401);
  });

  it('resets a password, forcing a change and ending sessions', async () => {
    const { user } = (await create({ name: 'T', email: 't3@example.org', password: 'a first password here' })).json();
    const before = await login(h.app, 't3@example.org', 'a first password here');
    const r = await h.app.inject({ method: 'POST', url: `/v1/admin/users/${user.id}/password`,
      headers: { cookie: admin }, payload: { password: 'a replacement password' } });
    expect(r.statusCode).toBe(204);
    expect((await h.app.inject({ method: 'GET', url: '/v1/auth/me', headers: { cookie: before } })).statusCode).toBe(401);
    const after = await login(h.app, 't3@example.org', 'a replacement password');
    expect((await h.app.inject({ method: 'GET', url: '/v1/auth/me', headers: { cookie: after } })).json().user.mustChangePassword).toBe(true);
  });
});
