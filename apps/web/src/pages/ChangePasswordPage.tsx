/**
 * Shown before anything else to an account whose password was handed out on
 * paper. The teacher who printed it has seen it, and so has anyone who found
 * the sheet, so the first thing a child does is make it theirs.
 */
import { useState } from 'react';
import { api, ApiError } from '../lib/api.ts';
import { useSession } from '../lib/session.tsx';

export function ChangePasswordPage() {
  const { user, refresh, signOut } = useSession();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (next !== again) { setError('Those two do not match.'); return; }
    setBusy(true);
    setError(null);
    try {
      await api.changePassword(current, next);
      // Changing the password ends every session, this one included, so the
      // account signs in again with the password it now owns.
      await refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not change the password.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="centred">
      <form className="card narrow" onSubmit={submit}>
        <h1 className="brand">fledge</h1>
        <h2>Choose your own password</h2>
        <p className="muted small">
          Hello, {user?.name}. The password you were given was printed on a sheet.
          Pick one only you know before you carry on.
        </p>
        <label>The password you were given
          <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" autoFocus required />
        </label>
        <label>Your new password
          <input type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" required minLength={10} />
        </label>
        <label>Type it again
          <input type="password" value={again} onChange={(e) => setAgain(e.target.value)} autoComplete="new-password" required />
        </label>
        {error && <p className="bad">{error}</p>}
        <div className="row">
          <button className="run" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save and continue'}</button>
          <button type="button" className="link" onClick={() => void signOut()}>Sign out</button>
        </div>
      </form>
    </div>
  );
}
