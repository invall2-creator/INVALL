import { useEffect } from 'react';
import { supabase } from './lib/supabase';

const BEAT_MS = 60_000;
const NEW_SESSION_AFTER_MS = 5 * 60_000;

/** While the app is open and visible, tells the server every minute that this user is connected. */
export function usePresence(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    let sessionId = crypto.randomUUID();
    let lastBeat = 0;
    const beat = () => {
      if (document.visibilityState !== 'visible') return;
      if (lastBeat && Date.now() - lastBeat > NEW_SESSION_AFTER_MS) sessionId = crypto.randomUUID();
      lastBeat = Date.now();
      void supabase.rpc('heartbeat', { session_id: sessionId });
    };
    beat();
    const timer = window.setInterval(beat, BEAT_MS);
    document.addEventListener('visibilitychange', beat);
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', beat); };
  }, [enabled]);
}
