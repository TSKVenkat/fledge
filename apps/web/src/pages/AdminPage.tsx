import { useEffect, useState } from 'react';
import { api, ApiError, type AdminUser } from '../lib/api.ts';

/**
 * Who can teach here. There is no self-registration and no email; an
 * administrator creates teachers, resets passwords, and disables accounts, and
 * every one of those takes effect on the account's next request.
 */
export function AdminPage() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'teacher' | 'admin'>('teacher');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = () => { void api.adminListUsers().then((r) => setUsers(r.users)).catch(() => setUsers([])); };
  useEffect(load, []);

  const act = async (work: () => Promise<unknown>, done?: string) => {
    setError(null); setNotice(null);
    try { await work(); load(); if (done) setNotice(done); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'That did not work.'); }
  };

  const staff = users.filter((u) => u.role !== 'student');
  const students = users.length - staff.length;

  return (
    <div className="page">
      <section className="card">
        <h2>Add a teacher</h2>
        <div className="row">
          <input placeholder="Name" value={name} aria-label="Name" onChange={(e) => setName(e.target.value)} />
          <input placeholder="Email" type="email" value={email} aria-label="Email" onChange={(e) => setEmail(e.target.value)} />
          <input placeholder="First password" type="text" value={password} aria-label="First password" onChange={(e) => setPassword(e.target.value)} />
          <select value={role} aria-label="Role" onChange={(e) => setRole(e.target.value as 'teacher' | 'admin')}>
            <option value="teacher">Teacher</option><option value="admin">Administrator</option>
          </select>
          <button className="run" disabled={!name.trim() || !email.trim() || !password}
                  onClick={() => void act(async () => {
                    await api.adminCreateUser({ name: name.trim(), email: email.trim(), password, role });
                    setName(''); setEmail(''); setPassword('');
                  }, 'Created. They will be asked to choose their own password when they first sign in.')}>
            Create
          </button>
        </div>
        {error && <p className="bad">{error}</p>}
        {notice && <p className="muted small">{notice}</p>}
      </section>

      <section className="card">
        <h2>Staff <span className="muted small">{staff.length}</span></h2>
        <table>
          <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>State</th><th /></tr></thead>
          <tbody>
            {staff.map((u) => (
              <tr key={u.id} className={u.isActive ? '' : 'muted'}>
                <td>{u.name}</td><td>{u.email}</td><td><span className="pill">{u.role}</span></td>
                <td>{u.isActive ? (u.mustChangePassword ? 'awaiting first sign-in' : 'active') : 'disabled'}</td>
                <td className="row">
                  <button className="link" onClick={() => {
                    const next = prompt(`New password for ${u.name}`);
                    if (next) void act(() => api.adminResetPassword(u.id, next), `Password reset. Tell ${u.name}; they will be asked to change it.`);
                  }}>Reset password</button>
                  <button className="link" onClick={() => void act(() => api.adminPatchUser(u.id, { isActive: !u.isActive }))}>
                    {u.isActive ? 'Disable' : 'Enable'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted small">{students} student account{students === 1 ? '' : 's'} are managed from their classes.</p>
      </section>
    </div>
  );
}
