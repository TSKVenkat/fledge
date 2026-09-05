import { Link, Navigate, Route, Routes } from 'react-router-dom';
import { useSession } from './lib/session.tsx';
import { LoginPage } from './pages/LoginPage.tsx';
import { HomePage } from './pages/HomePage.tsx';
import { ClassPage } from './pages/ClassPage.tsx';
import { AssignmentPage } from './pages/AssignmentPage.tsx';
import { EditorPage } from './pages/EditorPage.tsx';
import { SharePage } from './pages/SharePage.tsx';

function Chrome({ children }: { children: React.ReactNode }) {
  const { user, signOut } = useSession();
  return (
    <div className="shell">
      <nav>
        <Link className="brand" to="/">fledge</Link>
        <span className="meta">
          <span className="muted small">{user?.name}</span>
          <button className="link" onClick={() => void signOut()}>Sign out</button>
        </span>
      </nav>
      {children}
    </div>
  );
}

export function App() {
  const { user, loading } = useSession();

  return (
    <Routes>
      {/* The editor is deliberately outside the sign-in gate: someone with no
          account can write a program, and someone following a link should not
          meet a login form first. */}
      <Route path="/new" element={<EditorPage />} />
      <Route path="/p/:id" element={<EditorPage />} />
      {/* Public: this is where an embed sends a reader, and what a teacher hands out. */}
      <Route path="/s/:token" element={<SharePage />} />
      <Route
        path="*"
        element={
          loading ? <div className="centred"><p className="muted">…</p></div>
            : !user ? <LoginPage />
            : (
              <Chrome>
                <Routes>
                  <Route path="/" element={<HomePage />} />
                  <Route path="/classes/:id" element={<ClassPage />} />
                  <Route path="/assignments/:id" element={<AssignmentPage />} />
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
              </Chrome>
            )
        }
      />
    </Routes>
  );
}
