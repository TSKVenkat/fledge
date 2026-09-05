import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiError, type ClassRoom, type Project } from '../lib/api.ts';
import { useSession } from '../lib/session.tsx';

export function HomePage() {
  const { user } = useSession();
  const navigate = useNavigate();
  const [classes, setClasses] = useState<ClassRoom[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [joinCode, setJoinCode] = useState('');
  const [newClass, setNewClass] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    void api.listClasses().then((r) => setClasses(r.classes)).catch(() => setClasses([]));
    void api.listProjects().then((r) => setProjects(r.projects)).catch(() => setProjects([]));
  };
  useEffect(load, []);

  const act = async (work: () => Promise<unknown>) => {
    setError(null);
    try { await work(); load(); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'That did not work.'); }
  };

  const isTeacher = user !== null && user.role !== 'student';

  return (
    <div className="page">
      <section className="card">
        <h2>Classes</h2>
        {classes.length === 0 && <p className="muted">You are not in a class yet.</p>}
        <ul className="list">
          {classes.map((klass) => (
            <li key={klass.id}>
              <Link to={`/classes/${klass.id}`}>{klass.name}</Link>
              {klass.joinCode && <code className="code">{klass.joinCode}</code>}
            </li>
          ))}
        </ul>

        <div className="row">
          {/* Students join; teachers create. Both are one field and one button,
              because both happen in front of a class that is waiting. */}
          <input placeholder="Join code" value={joinCode} aria-label="Join code"
                 onChange={(e) => setJoinCode(e.target.value)} />
          <button className="run" disabled={!joinCode.trim()}
                  onClick={() => void act(async () => { await api.joinClass(joinCode.trim()); setJoinCode(''); })}>
            Join
          </button>
        </div>

        {isTeacher && (
          <div className="row">
            <input placeholder="New class name" value={newClass} aria-label="New class name"
                   onChange={(e) => setNewClass(e.target.value)} />
            <button disabled={!newClass.trim()}
                    onClick={() => void act(async () => {
                      const created = await api.createClass(newClass.trim());
                      setNewClass('');
                      navigate(`/classes/${created.class.id}`);
                    })}>
              Create class
            </button>
          </div>
        )}
        {error && <p className="bad">{error}</p>}
      </section>

      <section className="card">
        <h2>Projects</h2>
        <div className="row">
          <button className="run" onClick={() => void act(async () => {
            const created = await api.createProject({ title: 'Untitled' });
            navigate(`/p/${created.project.id}`);
          })}>New project</button>
        </div>
        {projects.length === 0 && <p className="muted">Nothing yet.</p>}
        <ul className="list">
          {projects.map((project) => (
            <li key={project.id}>
              <Link to={`/p/${project.id}`}>{project.title}</Link>
              <span className="muted small">{project.kind}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
