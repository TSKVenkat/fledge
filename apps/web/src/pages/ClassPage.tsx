import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, ApiError, type Assignment, type ClassRoom, type Member, type Project } from '../lib/api.ts';
import { useSession } from '../lib/session.tsx';

export function ClassPage() {
  const { id = '' } = useParams();
  const { user } = useSession();
  const [klass, setClass] = useState<ClassRoom | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [register, setRegister] = useState('');
  const [created, setCreated] = useState<{ name: string; username: string; password: string }[] | null>(null);
  const [title, setTitle] = useState('');
  const [template, setTemplate] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    void api.getClass(id).then((r) => { setClass(r.class); setMembers(r.members); }).catch(() => setClass(null));
    void api.listAssignments(id).then((r) => setAssignments(r.assignments)).catch(() => setAssignments([]));
    void api.listProjects().then((r) => setProjects(r.projects)).catch(() => setProjects([]));
  };
  useEffect(load, [id]);

  const act = async (work: () => Promise<unknown>) => {
    setError(null);
    try { await work(); load(); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'That did not work.'); }
  };

  if (!klass) return <div className="page"><p className="muted">Loading…</p></div>;
  // The join code is only ever sent to a teacher, so its presence is the
  // reliable signal — more reliable than re-deriving the role here.
  const isTeacher = klass.joinCode !== undefined || user?.role === 'admin';

  return (
    <div className="page">
      <section className="card">
        <h2>{klass.name}</h2>
        {isTeacher && (
          <div className="joincode">
            <span className="muted small">Join code</span>
            <code className="code big">{klass.joinCodeEnabled ? klass.joinCode : 'disabled'}</code>
            <button onClick={() => void act(() => api.rotateJoinCode(id))}>New code</button>
            {klass.joinCodeEnabled &&
              <button onClick={() => void act(() => api.disableJoinCode(id))}>Turn off</button>}
          </div>
        )}
      </section>

      <section className="card">
        <h2>Assignments</h2>
        {assignments.length === 0 && <p className="muted">None yet.</p>}
        <ul className="list">
          {assignments.map((task) => (
            <li key={task.id}>
              <Link to={`/assignments/${task.id}`}>{task.title}</Link>
              {task.publishedAt === null && <span className="pill">draft</span>}
            </li>
          ))}
        </ul>
        {isTeacher && (
          <div className="row">
            <input placeholder="Assignment title" value={title} aria-label="Assignment title"
                   onChange={(e) => setTitle(e.target.value)} />
            <select value={template} onChange={(e) => setTemplate(e.target.value)} aria-label="Starter project">
              <option value="">Starter project…</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
            </select>
            <button className="run" disabled={!title.trim() || !template}
                    onClick={() => void act(async () => {
                      await api.createAssignment(id, { title: title.trim(), templateProjectId: template });
                      setTitle(''); setTemplate('');
                    })}>Set</button>
          </div>
        )}
      </section>

      <section className="card">
        <h2>People <span className="muted small">{members.length}</span></h2>
        <ul className="list">
          {members.map((m) => (
            <li key={m.id}>
              <span>{m.name}</span>
              <span className="muted small">{m.username ?? ''} · {m.role}</span>
            </li>
          ))}
        </ul>

        {isTeacher && (
          <>
            <label>
              Add a register — one name per line
              <textarea rows={4} value={register} onChange={(e) => setRegister(e.target.value)}
                        placeholder={'Ada Lovelace\nAlan Turing'} />
            </label>
            <button disabled={!register.trim()} onClick={() => void act(async () => {
              const names = register.split('\n').map((n) => n.trim()).filter(Boolean);
              setCreated((await api.addStudents(id, names)).students);
              setRegister('');
            })}>Create accounts</button>

            {created && (
              <div className="passwords">
                {/* Shown once. There is no endpoint that will show them again,
                    which is why the page says so rather than implying a list
                    the teacher can come back to. */}
                <p className="bad">
                  Print or copy these now. Passwords are not stored in a form
                  anyone can read back, so this is the only time they appear.
                </p>
                <table>
                  <thead><tr><th>Name</th><th>Username</th><th>Password</th></tr></thead>
                  <tbody>
                    {created.map((s) => (
                      <tr key={s.username}>
                        <td>{s.name}</td><td><code>{s.username}</code></td><td><code>{s.password}</code></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
        {error && <p className="bad">{error}</p>}
      </section>
    </div>
  );
}
