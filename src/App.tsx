import { useState } from 'react';
import { configResult } from '@/lib/supabase';
import { signInWithGoogle, signOut, useSession } from '@/auth/useSession';
import { ThemeControl } from '@/ui/ThemeControl';

function Brand() {
  return <div className="brand">Mercury</div>;
}

function ConfigNotice({ problems }: { problems: string[] }) {
  return (
    <div className="gate">
      <div className="gate-card">
        <Brand />
        <h1>Almost there</h1>
        <p className="lede">
          Mercury needs a Supabase project before it can sign you in or store
          anything.
        </p>
        <div className="banner">
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
        <ol>
          <li>
            Create a project at <code>supabase.com</code>, choosing the
            Singapore region.
          </li>
          <li>
            Copy <code>.env.example</code> to <code>.env.local</code>.
          </li>
          <li>
            Fill in both values from Project Settings → API, then restart{' '}
            <code>npm run dev</code>.
          </li>
        </ol>
      </div>
    </div>
  );
}

function SignIn() {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSignIn() {
    setBusy(true);
    setError(null);
    const { error } = await signInWithGoogle();
    if (error) {
      setError(error);
      setBusy(false);
    }
  }

  return (
    <div className="gate">
      <div className="gate-card">
        <Brand />
        <h1>Know what to start</h1>
        <p className="lede">
          Mercury reads your calendar, works out how much time you actually
          have, and tells you which task needs starting now.
        </p>
        <button className="btn primary" onClick={onSignIn} disabled={busy}>
          {busy ? 'Opening Google…' : 'Continue with Google'}
        </button>
        {error ? <div className="banner">{error}</div> : null}
        <div style={{ marginTop: 6 }}>
          <div className="eyebrow" style={{ marginBottom: 8 }}>
            Appearance
          </div>
          <ThemeControl />
        </div>
      </div>
    </div>
  );
}

function AppShell({ email }: { email: string | undefined }) {
  return (
    <div className="app">
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          paddingBlock: '18px 10px',
        }}
      >
        <Brand />
        <span style={{ flex: 1 }} />
        <button className="btn ghost" onClick={() => void signOut()}>
          Sign out
        </button>
      </header>
      <main>
        <section className="panel">
          <div className="eyebrow">Phase 0</div>
          <h2 style={{ marginTop: 4 }}>Scaffold is up</h2>
          <p className="lede">
            Signed in as {email ?? 'an unknown account'}. The schema, auth and
            build pipeline are in place. Views arrive in phase 2.
          </p>
          <div style={{ marginTop: 16 }}>
            <div className="eyebrow" style={{ marginBottom: 8 }}>
              Appearance
            </div>
            <ThemeControl />
            <p className="muted" style={{ fontSize: 12.5, margin: '8px 0 0' }}>
              Saved on this device only.
            </p>
          </div>
        </section>
      </main>
    </div>
  );
}

export default function App() {
  const session = useSession();

  if (!configResult.ok)
    return <ConfigNotice problems={configResult.problems} />;
  if (session.status === 'loading') {
    return (
      <div className="gate">
        <div className="gate-card">
          <Brand />
          <p className="muted">Loading…</p>
        </div>
      </div>
    );
  }
  if (session.status === 'signed-out') return <SignIn />;
  return <AppShell email={session.session.user.email} />;
}
