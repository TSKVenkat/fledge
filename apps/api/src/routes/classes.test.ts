import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { users } from '@fledge/db';
import { createHarness, login, TEST_ADMIN, type Harness } from '../testing/harness.ts';
import { hashPassword } from '../auth/password.ts';

let h: Harness;
let teacher: string;

async function student(username: string): Promise<string> {
  await h.db.insert(users).values({
    name: username, username, passwordHash: await hashPassword('a long enough password'), role: 'student',
  });
  return login(h.app, username, 'a long enough password');
}

beforeEach(async () => {
  h = await createHarness();
  teacher = await login(h.app, TEST_ADMIN.email, TEST_ADMIN.password);
});
afterEach(async () => { await h.close(); });

const makeClass = (name = '7B') =>
  h.app.inject({ method: 'POST', url: '/v1/classes', headers: { cookie: teacher }, payload: { name } });

describe('classes', () => {
  it('gives a new class a join code a child can read off a board', async () => {
    const { class: klass } = (await makeClass()).json();
    expect(klass.joinCode).toHaveLength(7);
    // No O/0, I/1 or S/5: every one of those is a support incident.
    expect(klass.joinCode).toMatch(/^[ABCDEFGHJKLMNPQRTUVWXYZ23456789]{7}$/);
  });

  it('lets a student join with the code, and joining twice is a no-op', async () => {
    const { class: klass } = (await makeClass()).json();
    const pupil = await student('pupil01');
    const join = () => h.app.inject({
      method: 'POST', url: '/v1/classes/join', headers: { cookie: pupil },
      payload: { code: klass.joinCode },
    });
    expect((await join()).statusCode).toBe(200);
    expect((await join()).statusCode).toBe(200);

    const roster = await h.app.inject({
      method: 'GET', url: `/v1/classes/${klass.id}`, headers: { cookie: teacher },
    });
    expect(roster.json().members.filter((m: { role: string }) => m.role === 'student')).toHaveLength(1);
  });

  it('accepts a code typed in lower case', async () => {
    // Children will, and refusing would be a support call rather than security.
    const { class: klass } = (await makeClass()).json();
    const pupil = await student('pupil02');
    const joined = await h.app.inject({
      method: 'POST', url: '/v1/classes/join', headers: { cookie: pupil },
      payload: { code: klass.joinCode.toLowerCase() },
    });
    expect(joined.statusCode).toBe(200);
  });

  it('hides the join code from students', async () => {
    const { class: klass } = (await makeClass()).json();
    const pupil = await student('pupil03');
    await h.app.inject({
      method: 'POST', url: '/v1/classes/join', headers: { cookie: pupil }, payload: { code: klass.joinCode },
    });
    const seen = await h.app.inject({
      method: 'GET', url: `/v1/classes/${klass.id}`, headers: { cookie: pupil },
    });
    expect(seen.json().class.joinCode).toBeUndefined();
  });

  it('makes a wrong, a disabled and a rotated-away code indistinguishable', async () => {
    const { class: klass } = (await makeClass()).json();
    const pupil = await student('pupil04');
    const tryCode = (code: string) => h.app.inject({
      method: 'POST', url: '/v1/classes/join', headers: { cookie: pupil }, payload: { code },
    });

    const wrong = await tryCode('ZZZZZZZ');
    await h.app.inject({ method: 'DELETE', url: `/v1/classes/${klass.id}/join-code`, headers: { cookie: teacher } });
    const disabled = await tryCode(klass.joinCode);
    await h.app.inject({ method: 'POST', url: `/v1/classes/${klass.id}/join-code`, headers: { cookie: teacher } });
    const rotatedAway = await tryCode(klass.joinCode);

    for (const r of [wrong, disabled, rotatedAway]) expect(r.statusCode).toBe(404);
    expect(disabled.json()).toEqual(wrong.json());
    expect(rotatedAway.json()).toEqual(wrong.json());
  });

  it('rotating the code issues a different one that works', async () => {
    const { class: klass } = (await makeClass()).json();
    const rotated = await h.app.inject({
      method: 'POST', url: `/v1/classes/${klass.id}/join-code`, headers: { cookie: teacher },
    });
    const fresh = rotated.json().class.joinCode;
    expect(fresh).not.toBe(klass.joinCode);

    const pupil = await student('pupil05');
    const joined = await h.app.inject({
      method: 'POST', url: '/v1/classes/join', headers: { cookie: pupil }, payload: { code: fresh },
    });
    expect(joined.statusCode).toBe(200);
  });

  it('creates a whole register of accounts and returns their passwords once', async () => {
    const { class: klass } = (await makeClass()).json();
    const created = await h.app.inject({
      method: 'POST', url: `/v1/classes/${klass.id}/students`, headers: { cookie: teacher },
      payload: { names: ['Ada Lovelace', 'Alan Turing', 'Ada Lovelace'] },
    });
    expect(created.statusCode).toBe(201);
    const students = created.json().students;
    expect(students).toHaveLength(3);
    // A duplicate name must still get its own account and its own username.
    expect(new Set(students.map((s: { username: string }) => s.username)).size).toBe(3);
    for (const s of students) expect(s.password.length).toBeGreaterThan(8);

    // And those accounts must actually be able to sign in.
    const first = students[0];
    const cookie = await login(h.app, first.username, first.password);
    const me = await h.app.inject({ method: 'GET', url: '/v1/auth/me', headers: { cookie } });
    expect(me.json().user.mustChangePassword).toBe(true);
  });

  it('will not let a student create a class', async () => {
    const pupil = await student('pupil06');
    const attempt = await h.app.inject({
      method: 'POST', url: '/v1/classes', headers: { cookie: pupil }, payload: { name: 'Mine' },
    });
    expect(attempt.statusCode).toBe(403);
  });

  it('hides a class from someone who is not in it', async () => {
    const { class: klass } = (await makeClass()).json();
    const outsider = await student('outsider');
    const seen = await h.app.inject({
      method: 'GET', url: `/v1/classes/${klass.id}`, headers: { cookie: outsider },
    });
    expect(seen.statusCode).toBe(404);
  });

  it('refuses to remove the owner from their own class', async () => {
    const { class: klass } = (await makeClass()).json();
    const owner = await h.db.select().from(users).where(eq(users.email, TEST_ADMIN.email));
    const attempt = await h.app.inject({
      method: 'DELETE', url: `/v1/classes/${klass.id}/members/${owner[0]!.id}`, headers: { cookie: teacher },
    });
    expect(attempt.statusCode).toBe(400);
  });
});
