/**
 * One request wrapper, then a flat object of thin functions.
 *
 * Every response shape is declared here rather than inferred, so a change to
 * the API surfaces as a type error in the page that uses it rather than as
 * undefined at runtime.
 */
export class ApiError extends Error {
  override readonly name = 'ApiError';
  readonly status: number;
  readonly code: string;
  readonly retryable: boolean;
  readonly fields?: { path: string; message: string }[];

  constructor(status: number, body: { code?: string; message?: string; retryable?: boolean; fields?: { path: string; message: string }[] }) {
    super(body.message ?? 'Something went wrong.');
    this.status = status;
    this.code = body.code ?? 'UNKNOWN';
    this.retryable = body.retryable ?? false;
    this.fields = body.fields;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: 'same-origin',
    headers: {
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...init.headers,
    },
  });
  if (response.status === 204) return undefined as T;
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(response.status, body.error ?? {});
  return body as T;
}

const send = (method: string) => (path: string, payload?: unknown) =>
  request(path, { method, body: payload === undefined ? undefined : JSON.stringify(payload) });

export interface User {
  id: string; name: string; role: 'admin' | 'teacher' | 'student';
  email: string | null; username: string | null; mustChangePassword: boolean;
}
export interface Project {
  id: string; title: string; kind: 'python' | 'web';
  settings: { entry?: string }; ownerId: string | null; anonymous: boolean;
  createdAt: string; updatedAt: string;
}
export interface ClassRoom {
  id: string; name: string; ownerId: string;
  joinCode?: string; joinCodeEnabled?: boolean; archivedAt: string | null; createdAt: string;
}
export interface Member {
  id: string; name: string; username: string | null; role: 'teacher' | 'student'; joinedAt: string;
}
export interface Assignment {
  id: string; classId: string; templateProjectId: string; title: string;
  instructions: string; dueAt: string | null; publishedAt: string | null;
}
export interface Submission {
  id: string; assignmentId: string; studentId: string; projectId: string;
  state: 'not_started' | 'in_progress' | 'submitted' | 'returned'; submittedAt: string | null;
}
export interface GridRow {
  student: { id: string; name: string; username: string | null };
  submission: Submission | null;
  state: Submission['state'];
}
export interface ShareLink {
  id: string; visibility: 'link' | 'password' | 'authenticated';
  allowFork: boolean; allowEmbed: boolean;
  expiresAt: string | null; revokedAt: string | null; token?: string;
}

export const api = {
  config: () => request<{ sandboxUrl: string; publicUrl: string; allowMicropip: boolean }>('/v1/config'),

  login: (identifier: string, password: string) =>
    send('POST')('/v1/auth/login', { identifier, password }) as Promise<{ user: User }>,
  logout: () => send('POST')('/v1/auth/logout') as Promise<void>,
  me: () => request<{ user: User }>('/v1/auth/me'),
  changePassword: (currentPassword: string, newPassword: string) =>
    send('POST')('/v1/auth/password', { currentPassword, newPassword }) as Promise<void>,

  listProjects: () => request<{ projects: Project[] }>('/v1/projects'),
  createProject: (payload: { title?: string; kind?: 'python' | 'web'; files?: Record<string, string>; entry?: string }) =>
    send('POST')('/v1/projects', payload) as Promise<{ project: Project; editToken?: string }>,
  getProject: (id: string, editToken?: string) =>
    request<{ project: Project; files: Record<string, string> }>(
      `/v1/projects/${id}`, editToken ? { headers: { 'x-edit-token': editToken } } : {}),
  saveFiles: (id: string, files: Record<string, string>, editToken?: string) =>
    request<{ project: Project }>(`/v1/projects/${id}/files`, {
      method: 'PUT', body: JSON.stringify({ files }),
      headers: editToken ? { 'x-edit-token': editToken } : {},
    }),
  claimProject: (id: string, editToken: string) =>
    request<{ project: Project }>(`/v1/projects/${id}/claim`, {
      method: 'POST', headers: { 'x-edit-token': editToken },
    }),

  listClasses: () => request<{ classes: ClassRoom[] }>('/v1/classes'),
  createClass: (name: string) => send('POST')('/v1/classes', { name }) as Promise<{ class: ClassRoom }>,
  getClass: (id: string) => request<{ class: ClassRoom; members: Member[] }>(`/v1/classes/${id}`),
  joinClass: (code: string) => send('POST')('/v1/classes/join', { code }) as Promise<{ class: ClassRoom }>,
  rotateJoinCode: (id: string) => send('POST')(`/v1/classes/${id}/join-code`) as Promise<{ class: ClassRoom }>,
  disableJoinCode: (id: string) => send('DELETE')(`/v1/classes/${id}/join-code`) as Promise<{ class: ClassRoom }>,
  addStudents: (id: string, names: string[]) =>
    send('POST')(`/v1/classes/${id}/students`, { names }) as
      Promise<{ students: { name: string; username: string; password: string }[] }>,

  listAssignments: (classId: string) =>
    request<{ assignments: Assignment[] }>(`/v1/classes/${classId}/assignments`),
  createAssignment: (classId: string, payload: { title: string; templateProjectId: string; instructions?: string }) =>
    send('POST')(`/v1/classes/${classId}/assignments`, payload) as Promise<{ assignment: Assignment }>,
  getAssignment: (id: string) =>
    request<{ assignment: Assignment; submissions?: GridRow[]; submission?: Submission | null }>(`/v1/assignments/${id}`),
  publishAssignment: (id: string, published: boolean) =>
    request<{ assignment: Assignment }>(`/v1/assignments/${id}`, {
      method: 'PATCH', body: JSON.stringify({ published }),
    }),
  openAssignment: (id: string) =>
    send('POST')(`/v1/assignments/${id}/open`) as Promise<{ submission: Submission; created: boolean }>,
  submit: (id: string) => send('POST')(`/v1/submissions/${id}/submit`) as Promise<{ submission: Submission }>,
  returnWork: (id: string) => send('POST')(`/v1/submissions/${id}/return`) as Promise<{ submission: Submission }>,

  createShare: (projectId: string, payload: object = {}) =>
    send('POST')(`/v1/projects/${projectId}/shares`, payload) as Promise<{ share: ShareLink }>,
  listShares: (projectId: string) => request<{ shares: ShareLink[] }>(`/v1/projects/${projectId}/shares`),
  revokeShare: (id: string) => send('DELETE')(`/v1/shares/${id}`) as Promise<void>,
  getShared: (token: string) =>
    request<{ project: Project; share: { allowFork: boolean }; files: Record<string, string> }>(`/v1/shares/${token}`),
  forkShared: (token: string) =>
    send('POST')(`/v1/shares/${token}/fork`) as Promise<{ project: Project; editToken?: string }>,
};
