import { useEffect, useState } from 'react';

const CURRENT = import.meta.env.VITE_APP_VERSION as string | undefined;
const CHECK_MS = 5 * 60_000;

/** Shows a banner when a newer version of the app has been published (GitHub Pages caches pages for a few minutes). */
export function UpdateBanner() {
  const [outdated, setOutdated] = useState(false);
  useEffect(() => {
    if (!CURRENT) return;
    let active = true;
    const check = async () => {
      try {
        const res = await fetch(import.meta.env.BASE_URL + 'version.json?t=' + Date.now(), { cache: 'no-store' });
        if (!res.ok) return;
        const { version } = await res.json() as { version?: string };
        if (active && version && version !== CURRENT) setOutdated(true);
      } catch { /* offline: try later */ }
    };
    void check();
    const timer = window.setInterval(check, CHECK_MS);
    const onVisible = () => { if (document.visibilityState === 'visible') void check(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { active = false; window.clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); };
  }, []);
  if (!outdated) return null;
  return <div className="update-banner" role="status">
    <span>Hi ha una versió nova de l'app.</span>
    <button type="button" className="primary small" onClick={() => {
      const url = new URL(window.location.href);
      url.searchParams.set('v', Date.now().toString(36));
      window.location.replace(url.toString());
    }}>Actualitza</button>
  </div>;
}
