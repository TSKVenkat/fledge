/* Setup helpers for the stack suites: sign in, make a project, share it.

   Every call checks the response and reports status and body on failure. The
   first version of these fixtures assumed success, and when CI's API answered
   with an error the suite died on `undefined.token` -- a TypeError that hid the
   one thing anyone needed to know, which was what the API had actually said. */

export const APP = process.env.FLEDGE_URL ?? 'http://localhost:8080';
export const SANDBOX = process.env.FLEDGE_SANDBOX ?? 'http://localhost:8081';
export const ADMIN = {
  id: process.env.ADMIN_EMAIL ?? 'admin@example.org',
  password: process.env.ADMIN_PASSWORD ?? 'correct horse battery staple',
};

async function must(response, what) {
  if (response.ok) return response;
  const body = await response.text().catch(() => '');
  throw new Error(`${what}: HTTP ${response.status} ${body.slice(0, 300)}`);
}

/** Signs in as the administrator; returns a Cookie header value. */
export async function adminCookie() {
  const response = await must(await fetch(`${APP}/v1/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ identifier: ADMIN.id, password: ADMIN.password }),
  }), 'admin sign-in');
  const cookie = response.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  if (!cookie.includes('fledge_session=')) throw new Error('admin sign-in returned no session cookie');
  return cookie;
}

export async function createProject(cookie, title, files) {
  const response = await must(await fetch(`${APP}/v1/projects`, {
    method: 'POST', headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ title, files }),
  }), `creating project "${title}"`);
  return (await response.json()).project;
}

export async function shareProject(cookie, projectId, options = {}) {
  const response = await must(await fetch(`${APP}/v1/projects/${projectId}/shares`, {
    method: 'POST', headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify(options),
  }), 'creating share link');
  return (await response.json()).share;
}
