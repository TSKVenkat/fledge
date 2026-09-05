import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { users } from '@fledge/db';
import { createHarness, login, TEST_ADMIN, type Harness } from '../testing/harness.ts';
import { hashPassword } from '../auth/password.ts';

let h: Harness;
let teacher: string;
let classId: string;
let templateId: string;

async function joinAsStudent(username: string, joinCode: string): Promise<string> {
  await h.db.insert(users).values({
    name: username, username, passwordHash: await hashPassword('a long enough password'), role: 'student',
  });
  const cookie = await login(h.app, username, 'a long enough password');
  await h.app.inject({ method: 'POST', url: '/v1/classes/join', headers: { cookie }, payload: { code: joinCode } });
  return cookie;
}

let joinCode: string;

beforeEach(async () => {
  h = await createHarness();
  teacher = await login(h.app, TEST_ADMIN.email, TEST_ADMIN.password);
  const klass = (await h.app.inject({
    method: 'POST', url: '/v1/classes', headers: { cookie: teacher }, payload: { name: '9C' },
  })).json().class;
  classId = klass.id;
  joinCode = klass.joinCode;
  templateId = (await h.app.inject({
    method: 'POST', url: '/v1/projects', headers: { cookie: teacher },
    payload: { title: 'Loops starter', files: { 'main.py': '# write a loop here\n' } },
  })).json().project.id;
});
afterEach(async () => { await h.close(); });

const createTask = (payload: object = {}) => h.app.inject({
  method: 'POST', url: `/v1/classes/${classId}/assignments`, headers: { cookie: teacher },
  payload: { title: 'Loops', templateProjectId: templateId, ...payload },
});
const publish = (id: string) => h.app.inject({
  method: 'PATCH', url: `/v1/assignments/${id}`, headers: { cookie: teacher }, payload: { published: true },
});

describe('assignments', () => {
  it('keeps a draft invisible to students entirely', async () => {
    // Absent, not forbidden: a child should not learn that homework exists
    // before the teacher is ready to set it.
    const { assignment } = (await createTask()).json();
    const pupil = await joinAsStudent('pupil01', joinCode);
    const seen = await h.app.inject({
      method: 'GET', url: `/v1/assignments/${assignment.id}`, headers: { cookie: pupil },
    });
    expect(seen.statusCode).toBe(404);

    const listed = await h.app.inject({
      method: 'GET', url: `/v1/classes/${classId}/assignments`, headers: { cookie: pupil },
    });
    expect(listed.json().assignments).toHaveLength(0);
  });

  it('gives each student their own copy of the starter on first open', async () => {
    const { assignment } = (await createTask()).json();
    await publish(assignment.id);
    const pupil = await joinAsStudent('pupil02', joinCode);

    const opened = await h.app.inject({
      method: 'POST', url: `/v1/assignments/${assignment.id}/open`, headers: { cookie: pupil },
    });
    expect(opened.json().created).toBe(true);

    const project = await h.app.inject({
      method: 'GET', url: `/v1/projects/${opened.json().submission.projectId}`, headers: { cookie: pupil },
    });
    expect(project.json().files['main.py']).toBe('# write a loop here\n');
  });

  it('returns the same copy when opened again, not a fresh one', async () => {
    // A child who opens the task on Monday and again on Friday must come back
    // to their own work, not to a blank starter.
    const { assignment } = (await createTask()).json();
    await publish(assignment.id);
    const pupil = await joinAsStudent('pupil03', joinCode);

    const open = () => h.app.inject({
      method: 'POST', url: `/v1/assignments/${assignment.id}/open`, headers: { cookie: pupil },
    });
    const first = (await open()).json();
    const second = (await open()).json();
    expect(second.created).toBe(false);
    expect(second.submission.projectId).toBe(first.submission.projectId);
  });

  it('survives two tabs opening the assignment at once', async () => {
    const { assignment } = (await createTask()).json();
    await publish(assignment.id);
    const pupil = await joinAsStudent('pupil04', joinCode);

    const results = await Promise.all([1, 2, 3].map(() => h.app.inject({
      method: 'POST', url: `/v1/assignments/${assignment.id}/open`, headers: { cookie: pupil },
    })));
    const ids = new Set(results.map((r) => r.json().submission.projectId));
    expect(ids.size).toBe(1);
  });

  it('shows a teacher every student, including those who have not started', async () => {
    const { assignment } = (await createTask()).json();
    await publish(assignment.id);
    const started = await joinAsStudent('started', joinCode);
    await joinAsStudent('notstarted', joinCode);
    await h.app.inject({
      method: 'POST', url: `/v1/assignments/${assignment.id}/open`, headers: { cookie: started },
    });

    const grid = (await h.app.inject({
      method: 'GET', url: `/v1/assignments/${assignment.id}`, headers: { cookie: teacher },
    })).json();
    expect(grid.submissions).toHaveLength(2);
    const states = Object.fromEntries(grid.submissions.map(
      (s: { student: { username: string }; state: string }) => [s.student.username, s.state]));
    expect(states).toEqual({ started: 'in_progress', notstarted: 'not_started' });
  });

  it('moves a submission through submitted and returned', async () => {
    const { assignment } = (await createTask()).json();
    await publish(assignment.id);
    const pupil = await joinAsStudent('pupil05', joinCode);
    const { submission } = (await h.app.inject({
      method: 'POST', url: `/v1/assignments/${assignment.id}/open`, headers: { cookie: pupil },
    })).json();

    const submitted = await h.app.inject({
      method: 'POST', url: `/v1/submissions/${submission.id}/submit`, headers: { cookie: pupil },
    });
    expect(submitted.json().submission.state).toBe('submitted');
    expect(submitted.json().submission.submittedAt).not.toBeNull();

    const returned = await h.app.inject({
      method: 'POST', url: `/v1/submissions/${submission.id}/return`, headers: { cookie: teacher },
    });
    expect(returned.json().submission.state).toBe('returned');
  });

  it('will not let one student submit another’s work', async () => {
    const { assignment } = (await createTask()).json();
    await publish(assignment.id);
    const mine = await joinAsStudent('mine', joinCode);
    const theirs = await joinAsStudent('theirs', joinCode);
    const { submission } = (await h.app.inject({
      method: 'POST', url: `/v1/assignments/${assignment.id}/open`, headers: { cookie: mine },
    })).json();

    const attempt = await h.app.inject({
      method: 'POST', url: `/v1/submissions/${submission.id}/submit`, headers: { cookie: theirs },
    });
    expect(attempt.statusCode).toBe(404);
  });

  it('hides an assignment from someone not in the class', async () => {
    const { assignment } = (await createTask()).json();
    await publish(assignment.id);
    await h.db.insert(users).values({
      name: 'outsider', username: 'outsider',
      passwordHash: await hashPassword('a long enough password'), role: 'student',
    });
    const outsider = await login(h.app, 'outsider', 'a long enough password');
    const seen = await h.app.inject({
      method: 'GET', url: `/v1/assignments/${assignment.id}`, headers: { cookie: outsider },
    });
    expect(seen.statusCode).toBe(404);
  });

  it('refuses an assignment whose starter project does not exist', async () => {
    const response = await createTask({ templateProjectId: '00000000-0000-4000-8000-000000000000' });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('NO_TEMPLATE');
  });
});
