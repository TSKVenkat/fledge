import { useState } from 'react';
import { useSession } from '../lib/session.tsx';
import { ApiError } from '../lib/api.ts';

export function LoginPage() {
  const { signIn } = useSession();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signIn(identifier, password);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not sign in.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="centred">
      <form className="card narrow" onSubmit={submit}>
        <h1 className="brand">fledge</h1>
        <label>
          Email or username
          {/* One field: a teacher has an email, a child has a username, and
              neither should have to work out which box theirs goes in. */}
          <input value={identifier} onChange={(e) => setIdentifier(e.target.value)}
                 autoComplete="username" autoFocus required />
        </label>
        <label>
          Password
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                 autoComplete="current-password" required />
        </label>
        {error && <p className="bad">{error}</p>}
        <button className="run" type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </div>
  );
}
