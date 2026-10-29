import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';

export type SessionState =
  | { status: 'loading' }
  | { status: 'signed-out' }
  | { status: 'signed-in'; session: Session };

export function useSession(): SessionState {
  const [state, setState] = useState<SessionState>(
    supabase ? { status: 'loading' } : { status: 'signed-out' },
  );

  useEffect(() => {
    if (!supabase) return;
    let active = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setState(
        data.session
          ? { status: 'signed-in', session: data.session }
          : { status: 'signed-out' },
      );
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setState(
        session ? { status: 'signed-in', session } : { status: 'signed-out' },
      );
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  return state;
}

export async function signInWithGoogle(): Promise<{ error: string | null }> {
  if (!supabase) return { error: 'Supabase is not configured.' };
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin },
  });
  return { error: error?.message ?? null };
}

export async function signOut(): Promise<void> {
  await supabase?.auth.signOut();
}
