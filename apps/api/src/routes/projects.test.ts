import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHarness, login, TEST_ADMIN, type Harness } from '../testing/harness.ts';

let h: Harness;
beforeEach(async () => { h = await createHarness(); });
afterEach(async () => { await h.close(); });

const create = (payload: object, headers: Record<string, string> = {}) =>
  h.app.inject({ method: 'POST', url: '/v1/projects', payload, headers });

describe('projects', () => {
  it('lets someone with no account create a project and get an edit token', async () => {
    const response = await create({ title: 'Scratch', files: { 'main.py': 'print(1)' } });
    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.project.anonymous).toBe(true);
    expect(typeof body.editToken).toBe('string');
  });

  it('reopens an anonymous project with its edit token', async () => {
    // This is what makes "type something, close the tab, come back tomorrow"
    // work without asking a child for an email address.
    const { project, editToken } = (await create({ files: { 'main.py': 'x = 1' } })).json();
    const reopened = await h.app.inject({
      method: 'GET', url: `/v1/projects/${project.id}`, headers: { 'x-edit-token': editToken },
    });
    expect(reopened.statusCode).toBe(200);
    expect(reopened.json().files['main.py']).toBe('x = 1');
  });

  it('hides an anonymous project from someone without the token', async () => {
    const { project } = (await create({ files: { 'main.py': 'secret' } })).json();
    const response = await h.app.inject({ method: 'GET', url: `/v1/projects/${project.id}` });
    expect(response.statusCode).toBe(404);
  });

  it('gives the same answer for someone else’s project and one that never existed', async () => {
    // A different status for the two would confirm which ids are real.
    const { project } = (await create({ files: { 'main.py': '1' } })).json();
    const mine = await h.app.inject({ method: 'GET', url: `/v1/projects/${project.id}` });
    const absent = await h.app.inject({
      method: 'GET', url: '/v1/projects/00000000-0000-4000-8000-000000000000',
    });
    expect(mine.statusCode).toBe(absent.statusCode);
    expect(mine.json()).toEqual(absent.json());
  });

  it('replaces the whole file set on save, removing files that went away', async () => {
    const { project, editToken } = (await create({
      files: { 'main.py': 'a', 'helper.py': 'b' },
    })).json();
    const saved = await h.app.inject({
      method: 'PUT', url: `/v1/projects/${project.id}/files`,
      headers: { 'x-edit-token': editToken }, payload: { files: { 'main.py': 'c' } },
    });
    expect(saved.statusCode).toBe(200);
    const after = await h.app.inject({
      method: 'GET', url: `/v1/projects/${project.id}`, headers: { 'x-edit-token': editToken },
    });
    expect(after.json().files).toEqual({ 'main.py': 'c' });
  });

  it('refuses a path that climbs out of the project', async () => {
    const response = await create({ files: { '../../etc/passwd': 'x' } });
    expect(response.statusCode).toBe(400);
  });

  it('refuses an absolute path', async () => {
    expect((await create({ files: { '/etc/passwd': 'x' } })).statusCode).toBe(400);
  });

  it('refuses a file larger than the per-file limit', async () => {
    const response = await create({ files: { 'main.py': 'x'.repeat(600 * 1024) } });
    expect(response.statusCode).toBe(413);
  });

  it('refuses a project with no files at all', async () => {
    const { project, editToken } = (await create({ files: { 'main.py': 'a' } })).json();
    const response = await h.app.inject({
      method: 'PUT', url: `/v1/projects/${project.id}/files`,
      headers: { 'x-edit-token': editToken }, payload: { files: {} },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('EMPTY_PROJECT');
  });

  it('claims an anonymous project into an account, and retires the token', async () => {
    const { project, editToken } = (await create({ files: { 'main.py': 'mine' } })).json();
    const cookie = await login(h.app, TEST_ADMIN.email, TEST_ADMIN.password);

    const claimed = await h.app.inject({
      method: 'POST', url: `/v1/projects/${project.id}/claim`,
      headers: { cookie, 'x-edit-token': editToken },
    });
    expect(claimed.statusCode).toBe(200);
    expect(claimed.json().project.anonymous).toBe(false);

    // The token must stop working, or a shared link would remain a way in.
    const withToken = await h.app.inject({
      method: 'GET', url: `/v1/projects/${project.id}`, headers: { 'x-edit-token': editToken },
    });
    expect(withToken.statusCode).toBe(404);
  });

  it('never returns the edit token hash or its ciphertext', async () => {
    const response = await create({ files: { 'main.py': '1' } });
    const serialised = JSON.stringify(response.json().project);
    for (const leak of ['editTokenHash', 'editTokenCt', 'editTokenIv', 'editTokenTag']) {
      expect(serialised).not.toContain(leak);
    }
  });

  it('renames a project, for its owner or its token holder', async () => {
    const { project, editToken } = (await create({ files: { 'main.py': '1' } })).json();
    const renamed = await h.app.inject({
      method: 'PATCH', url: `/v1/projects/${project.id}`,
      headers: { 'x-edit-token': editToken }, payload: { title: 'Spirals' },
    });
    expect(renamed.statusCode).toBe(200);
    expect(renamed.json().project.title).toBe('Spirals');
    const stranger = await h.app.inject({
      method: 'PATCH', url: `/v1/projects/${project.id}`, payload: { title: 'Mine now' },
    });
    expect(stranger.statusCode).toBe(404);
  });

  it('soft-deletes a project so it stops being available', async () => {
    const { project, editToken } = (await create({ files: { 'main.py': '1' } })).json();
    const gone = await h.app.inject({
      method: 'DELETE', url: `/v1/projects/${project.id}`, headers: { 'x-edit-token': editToken },
    });
    expect(gone.statusCode).toBe(204);
    const after = await h.app.inject({
      method: 'GET', url: `/v1/projects/${project.id}`, headers: { 'x-edit-token': editToken },
    });
    expect(after.statusCode).toBe(404);
  });

  it('lists only the signed-in owner’s own projects', async () => {
    const cookie = await login(h.app, TEST_ADMIN.email, TEST_ADMIN.password);
    await create({ title: 'Mine', files: { 'main.py': '1' } }, { cookie });
    await create({ title: 'Anonymous', files: { 'main.py': '2' } });
    const list = await h.app.inject({ method: 'GET', url: '/v1/projects', headers: { cookie } });
    expect(list.json().projects.map((p: { title: string }) => p.title)).toEqual(['Mine']);
  });
});
