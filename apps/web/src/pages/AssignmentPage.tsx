import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, ApiError, type Assignment, type GridRow, type Submission } from '../lib/api.ts';

const LABEL: Record<Submission['state'], string> = {
  not_started: 'not started', in_progress: 'working', submitted: 'submitted', returned: 'returned',
};

export function AssignmentPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [task, setTask] = useState<Assignment | null>(null);
  const [grid, setGrid] = useState<GridRow[] | null>(null);
  const [mine, setMine] = useState<Submission | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    void api.getAssignment(id)
      .then((r) => { setTask(r.assignment); setGrid(r.submissions ?? null); setMine(r.submission ?? null); })
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Not available.'));
  };
  useEffect(load, [id]);

  const act = async (work: () => Promise<unknown>) => {
    setError(null);
    try { await work(); load(); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'That did not work.'); }
  };

  if (error && !task) return <div className="page"><p className="bad">{error}</p></div>;
  if (!task) return <div className="page"><p className="muted">Loading…</p></div>;

  // Only a teacher is sent the grid, so its presence is the signal.
  const isTeacher = grid !== null;

  return (
    <div className="page">
      <section className="card">
        <h2>{task.title}</h2>
        {task.instructions && <p>{task.instructions}</p>}
        {isTeacher && (
          <div className="row">
            <span className="pill">{task.publishedAt ? 'published' : 'draft'}</span>
            <button className={task.publishedAt ? '' : 'run'}
                    onClick={() => void act(() => api.publishAssignment(id, task.publishedAt === null))}>
              {task.publishedAt ? 'Unpublish' : 'Publish to the class'}
            </button>
          </div>
        )}
        {!isTeacher && (
          <div className="row">
            <button className="run" onClick={() => void act(async () => {
              // Get-or-create: opening it again returns the work already done.
              const opened = await api.openAssignment(id);
              navigate(`/p/${opened.submission.projectId}`);
            })}>{mine ? 'Continue' : 'Start'}</button>
            {mine && mine.state !== 'submitted' && (
              <button onClick={() => void act(() => api.submit(mine.id))}>Hand in</button>
            )}
            {mine && <span className="pill">{LABEL[mine.state]}</span>}
          </div>
        )}
        {error && <p className="bad">{error}</p>}
      </section>

      {isTeacher && (
        <section className="card">
          <h2>Class <span className="muted small">{grid.length}</span></h2>
          {/* Every student, including those who have not begun -- that is the
              question a teacher is actually asking. */}
          <table className="grid">
            <thead><tr><th>Student</th><th>State</th><th /></tr></thead>
            <tbody>
              {grid.map((row) => (
                <tr key={row.student.id}>
                  <td>{row.student.name}</td>
                  <td><span className={`pill ${row.state}`}>{LABEL[row.state]}</span></td>
                  <td>
                    {row.submission && (
                      <>
                        <Link to={`/p/${row.submission.projectId}`}>Open</Link>
                        {row.state === 'submitted' && (
                          <button className="link" onClick={() => void act(() => api.returnWork(row.submission!.id))}>
                            Return
                          </button>
                        )}
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
