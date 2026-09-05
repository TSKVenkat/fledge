import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHarness, login, TEST_ADMIN, type Harness } from '../testing/harness.ts';

let h: Harness;
let cookie: string;
let projectId: string;

beforeEach(async () => {
  h = await createHarness();
  cookie = await login(h.app, TEST_ADMIN.email, TEST_ADMIN.password);
  const created = await h.app.inject({
    method: 'POST', url: '/v1/projects', headers: { cookie },
    payload: { title: 'Spiral', files: { 'main.py': 'print("hi")' } },
  });
  projectId = created.json().project.id;
});
afterEach(async () => { await h.close(); });

const share = (payload: object = {}) => h.app.inject({
  method: 'POST', url: `/v1/projects/${projectId}/shares`, headers: { cookie }, payload,
});

describe('share links', () => {
  it('opens a shared project with no account at all', async () => {
    const { share: link } = (await share()).json();
    const opened = await h.app.inject({ method: 'GET', url: `/v1/shares/${link.token}` });
    expect(opened.statusCode).toBe(200);
    expect(opened.json().files['main.py']).toBe('print("hi")');
  });

  it('mints a token long enough that guessing is not a strategy', async () => {
    const { share: link } = (await share()).json();
    expect(link.token.length).toBeGreaterThanOrEqual(43);
  });

  it('never returns the token hash', async () => {
    const response = await share();
    expect(JSON.stringify(response.json())).not.toContain('tokenHash');
  });

  it('can show the owner their own link again, from the sealed copy', async () => {
    const { share: created } = (await share()).json();
    const listed = await h.app.inject({
      method: 'GET', url: `/v1/projects/${projectId}/shares`, headers: { cookie },
    });
    expect(listed.json().shares[0].token).toBe(created.token);
  });

  it('makes revoked, expired and never-existed indistinguishable', async () => {
    // Different answers would let someone probe which projects exist.
    const { share: link } = (await share()).json();
    await h.app.inject({ method: 'DELETE', url: `/v1/shares/${link.id}`, headers: { cookie } });

    const revoked = await h.app.inject({ method: 'GET', url: `/v1/shares/${link.token}` });
    const never = await h.app.inject({ method: 'GET', url: `/v1/shares/${'z'.repeat(43)}` });
    const expiredResponse = await share({ expiresAt: new Date(Date.now() - 1000).toISOString() });
    const expired = await h.app.inject({
      method: 'GET', url: `/v1/shares/${expiredResponse.json().share.token}`,
    });

    for (const r of [revoked, never, expired]) expect(r.statusCode).toBe(404);
    expect(revoked.json()).toEqual(never.json());
    expect(expired.json()).toEqual(never.json());
  });

  it('asks for a password with a distinct code, not a dead link', async () => {
    const { share: link } = (await share({ visibility: 'password', password: 'open sesame please' })).json();
    const locked = await h.app.inject({ method: 'GET', url: `/v1/shares/${link.token}` });
    expect(locked.statusCode).toBe(403);
    expect(locked.json().error.code).toBe('PASSWORD_REQUIRED');
  });

  it('opens after unlocking, using a signed cookie that is never stored', async () => {
    const { share: link } = (await share({ visibility: 'password', password: 'open sesame please' })).json();
    const unlocked = await h.app.inject({
      method: 'POST', url: `/v1/shares/${link.token}/unlock`, payload: { password: 'open sesame please' },
    });
    expect(unlocked.statusCode).toBe(204);
    const jar = unlocked.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
    const opened = await h.app.inject({
      method: 'GET', url: `/v1/shares/${link.token}`, headers: { cookie: jar },
    });
    expect(opened.statusCode).toBe(200);
  });

  it('refuses a wrong password without revealing the link exists', async () => {
    const { share: link } = (await share({ visibility: 'password', password: 'open sesame please' })).json();
    const bad = await h.app.inject({
      method: 'POST', url: `/v1/shares/${link.token}/unlock`, payload: { password: 'wrong' },
    });
    const nonexistent = await h.app.inject({
      method: 'POST', url: `/v1/shares/${'q'.repeat(43)}/unlock`, payload: { password: 'wrong' },
    });
    expect(bad.statusCode).toBe(404);
    expect(bad.json()).toEqual(nonexistent.json());
  });

  it('requires an account when the link says so', async () => {
    const { share: link } = (await share({ visibility: 'authenticated' })).json();
    const anonymous = await h.app.inject({ method: 'GET', url: `/v1/shares/${link.token}` });
    expect(anonymous.statusCode).toBe(403);
    const signedIn = await h.app.inject({ method: 'GET', url: `/v1/shares/${link.token}`, headers: { cookie } });
    expect(signedIn.statusCode).toBe(200);
  });

  it('forks a shared project into a fresh anonymous copy', async () => {
    const { share: link } = (await share()).json();
    const forked = await h.app.inject({ method: 'POST', url: `/v1/shares/${link.token}/fork` });
    expect(forked.statusCode).toBe(201);
    const body = forked.json();
    expect(body.project.title).toBe('Spiral (copy)');
    expect(typeof body.editToken).toBe('string');

    const opened = await h.app.inject({
      method: 'GET', url: `/v1/projects/${body.project.id}`, headers: { 'x-edit-token': body.editToken },
    });
    expect(opened.json().files['main.py']).toBe('print("hi")');
  });

  it('refuses to fork when the link forbids it', async () => {
    const { share: link } = (await share({ allowFork: false })).json();
    const forked = await h.app.inject({ method: 'POST', url: `/v1/shares/${link.token}/fork` });
    expect(forked.statusCode).toBe(404);
  });

  it('will not let someone else share a project they do not own', async () => {
    const other = await h.app.inject({
      method: 'POST', url: `/v1/projects/${projectId}/shares`, payload: {},
    });
    expect(other.statusCode).toBe(404);
  });
});
