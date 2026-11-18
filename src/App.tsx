import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import type { User } from '@supabase/supabase-js';
import { supabase } from './lib/supabase';
import { ProfilePhoto } from './ProfilePhoto';
import { FlightBackup } from './FlightBackup';
import type { AppData } from './context';
import {
  isMissingMigration, loadAircraft, loadFlights, loadProfile, loadTeam,
  type Aircraft, type Flight, type Flight as FlightRow, type Member, type Profile,
} from './flight-data';
import { Dashboard } from './views/Dashboard';
import { FlightForm } from './views/FlightForm';
import { History } from './views/History';
import { Team } from './views/Team';
import { Fleet } from './views/Fleet';
import { Rooftops } from './views/Rooftops';
import { usePresence } from './presence';
import { UpdateBanner } from './UpdateBanner';

const VIEWS = ['tauler', 'registra', 'historial', 'terrats', 'copia-de-seguretat', 'equip', 'flota'] as const;
type View = typeof VIEWS[number];
// Enllaços de la versió anterior
const LEGACY: Record<string, View> = { 'els-meus-vols': 'tauler', 'gestiona-els-vols': 'historial', excel: 'historial', 'comptes-de-pilots': 'equip' };
const appUrl = () => window.location.origin + import.meta.env.BASE_URL;

/**
 * Result of a link from an email (account confirmation, password reset), read once at start-up.
 * Supabase puts errors in the hash or the query (#error=access_denied&error_code=otp_expired…)
 * and a successful sign-up as #access_token=…&type=signup.
 */
type AuthNotice = { kind: 'confirmed' | 'expired' | 'error'; text: string };
const AUTH_NOTICE: AuthNotice | null = (() => {
  const params = new URLSearchParams(window.location.hash.slice(1));
  const query = new URLSearchParams(window.location.search);
  const get = (k: string) => params.get(k) ?? query.get(k);
  const code = get('error_code'), error = get('error');
  if (error || code) {
    window.history.replaceState(null, '', import.meta.env.BASE_URL);
    return code === 'otp_expired' || /expired|invalid/i.test(get('error_description') ?? '')
      ? { kind: 'expired', text: "Aquest enllaç del correu ja s'ha fet servir o ha caducat. Si ja l'havies obert abans, el compte ja està confirmat: entra amb el teu correu i contrasenya. Si no, escriu el teu correu a dalt i prem «Envia'm un enllaç nou»." }
      : { kind: 'error', text: "No s'ha pogut completar l'enllaç del correu. Prova d'entrar amb el teu correu i contrasenya o demana un enllaç nou." };
  }
  if (params.get('access_token') && params.get('type') === 'signup') {
    return { kind: 'confirmed', text: "Correu confirmat correctament. La teva sol·licitud ja ha arribat a l'administració: quan l'autoritzin, podràs fer servir l'app." };
  }
  return null;
})();

function currentView(): View {
  const hash = window.location.hash.slice(1);
  return (VIEWS as readonly string[]).includes(hash) ? hash as View : LEGACY[hash] ?? 'tauler';
}

function Brand() {
  return <div className="brand"><h1><b>UDRON</b> · Control de vols</h1><span>Llibre de vols de pilots RPAS</span></div>;
}

export function App() {
  return <><UpdateBanner /><AppInner /></>;
}

function AppInner() {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [recovering, setRecovering] = useState(false);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') setRecovering(true);
      setUser(session?.user ?? null);
      setReady(true);
    });
    return () => subscription.unsubscribe();
  }, []);

  if (!ready) return <div className="auth"><Brand /><p role="status">Carregant…</p></div>;
  if (recovering) return <NewPassword onDone={() => setRecovering(false)} />;
  return user ? <Shell key={user.id} user={user} /> : <AccessForm />;
}

function AccessForm() {
  const [mode, setMode] = useState<'login' | 'register' | 'reset'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState(AUTH_NOTICE?.text ?? '');
  const [canResend, setCanResend] = useState(AUTH_NOTICE?.kind === 'expired' || AUTH_NOTICE?.kind === 'error');
  const [busy, setBusy] = useState(false);

  async function resend() {
    if (!email.trim()) { setMessage('Escriu el teu correu electrònic i torna a prémer el botó.'); return; }
    setBusy(true);
    const { error } = await supabase.auth.resend({ type: 'signup', email: email.trim(), options: { emailRedirectTo: appUrl() } });
    setBusy(false);
    setMessage(error
      ? (/already|confirmed/i.test(error.message) ? 'Aquest correu ja està confirmat. Entra amb la teva contrasenya.' : 'No s’ha pogut enviar. Espera un minut i torna-ho a provar.')
      : 'T’hem enviat un enllaç nou. Obre’l una sola vegada; si el correu tarda, mira la carpeta de correu brossa.');
    if (!error) setCanResend(false);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      if (mode === 'register') {
        if (!name.trim()) { setMessage('Introdueix el teu nom i cognoms.'); return; }
        const { error } = await supabase.auth.signUp({
          email: email.trim(), password,
          options: { data: { display_name: name.trim() }, emailRedirectTo: appUrl() },
        });
        if (error) setMessage(error.code === 'signup_disabled' ? 'El registre no està obert ara mateix.' : 'No s’ha pogut tramitar el registre. Revisa les dades o torna-ho a provar més tard.');
        else { setMode('login'); setCanResend(false); setMessage('Sol·licitud enviada. Ara obre el correu que t’hem enviat i prem l’enllaç de confirmació (només una vegada). Després, l’administració haurà d’autoritzar-te; fins llavors, en entrar veuràs que la sol·licitud està pendent.'); }
      } else if (mode === 'reset') {
        await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: appUrl() });
        setMode('login');
        setMessage('Si el correu és d’un compte d’UDRON, rebràs un enllaç per posar una contrasenya nova.');
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error) {
          const unconfirmed = error.code === 'email_not_confirmed';
          setCanResend(unconfirmed);
          setMessage(unconfirmed ? 'Encara no has confirmat el correu electrònic. Busca el correu d’UDRON (mira també el correu brossa) o demana un enllaç nou.' : 'No s’ha pogut entrar. Comprova el correu i la contrasenya.');
        }
      }
    } catch {
      setMessage('No s’ha pogut connectar amb UDRON. Torna-ho a provar.');
    } finally {
      setPassword('');
      setBusy(false);
    }
  }

  const title = { login: 'Accés de pilots', register: 'Sol·licita un compte de pilot', reset: 'Recupera la contrasenya' }[mode];
  return <div className="auth">
    <Brand />
    <form className="panel auth-card" onSubmit={submit}>
      <h2>{title}</h2>
      {mode === 'register' && <label htmlFor="acc-nom">Nom i cognoms<input id="acc-nom" autoComplete="name" value={name} onChange={e => setName(e.target.value)} maxLength={120} required /></label>}
      <label htmlFor="acc-correu">Correu electrònic<input id="acc-correu" type="email" autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} required /></label>
      {mode !== 'reset' && <label htmlFor="acc-contrasenya">Contrasenya<input id="acc-contrasenya" type="password" autoComplete={mode === 'register' ? 'new-password' : 'current-password'} minLength={mode === 'register' ? 8 : undefined} value={password} onChange={e => setPassword(e.target.value)} required /></label>}
      <button className="primary" disabled={busy}>{{ login: 'Entra', register: 'Envia la sol·licitud', reset: "Envia'm l'enllaç" }[mode]}</button>
      {message && <p className={AUTH_NOTICE?.kind === 'expired' || canResend ? 'notice' : 'ok'} role="status">{message}</p>}
      {canResend && <button type="button" onClick={() => void resend()} disabled={busy}>Envia'm un enllaç nou</button>}
      <div className="auth-links">
        {mode !== 'login' && <button type="button" className="link" onClick={() => { setMode('login'); setMessage(''); }}>Torna a l'inici de sessió</button>}
        {mode === 'login' && <button type="button" className="link" onClick={() => { setMode('reset'); setMessage(''); }}>He oblidat la contrasenya</button>}
        {mode === 'login' && <button type="button" className="link" onClick={() => { setMode('register'); setMessage(''); }}>Sol·licita un compte</button>}
      </div>
    </form>
  </div>;
}

function NewPassword({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (password.length < 8) { setMessage('Ha de tenir almenys 8 caràcters.'); return; }
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) { setMessage('No s’ha pogut canviar. Demana un enllaç nou i torna-ho a provar.'); return; }
    window.history.replaceState(null, '', import.meta.env.BASE_URL + '#tauler');
    onDone();
  }
  return <div className="auth"><Brand />
    <form className="panel auth-card" onSubmit={submit}>
      <h2>Contrasenya nova</h2>
      <label htmlFor="nova-contrasenya">Contrasenya nova<input id="nova-contrasenya" type="password" autoComplete="new-password" minLength={8} value={password} onChange={e => setPassword(e.target.value)} required /></label>
      <button className="primary" disabled={busy}>Desa la contrasenya</button>
      {message && <p className="err" role="alert">{message}</p>}
    </form>
  </div>;
}

function Shell({ user }: { user: User }) {
  const [view, setView] = useState<View>(currentView);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [flights, setFlights] = useState<Flight[]>([]);
  const [aircraft, setAircraft] = useState<Aircraft[]>([]);
  const [team, setTeam] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [problem, setProblem] = useState('');
  const [reloadTick, setReloadTick] = useState(0);
  const [editing, setEditing] = useState<FlightRow | null>(null);
  const [pilotFilter, setPilotFilter] = useState('');
  const reload = useCallback(() => setReloadTick(t => t + 1), []);

  useEffect(() => { if (view !== 'historial') setPilotFilter(''); }, [view]);

  useEffect(() => {
    const follow = () => setView(currentView());
    window.addEventListener('hashchange', follow);
    return () => window.removeEventListener('hashchange', follow);
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const me = await loadProfile(user.id);
        const admin = me.role === 'admin' && me.approval_status === 'approved';
        const [rows, fleet, members] = me.approval_status === 'approved'
          ? await Promise.all([loadFlights(admin ? undefined : user.id), loadAircraft(), admin ? loadTeam() : Promise.resolve([])])
          : [[], [], []];
        if (!active) return;
        setProfile(me); setFlights(rows); setAircraft(fleet); setTeam(members); setProblem('');
      } catch (error) {
        if (active) setProblem(isMissingMigration(error)
          ? 'Falta aplicar la migració 20261122_udron_v3.sql a Supabase. Avisa l’administració.'
          : 'No s’han pogut carregar les dades. Comprova la connexió i torna-ho a provar.');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [user.id, reloadTick]);

  const data: AppData | null = useMemo(() => {
    if (!profile) return null;
    const names = new Map(team.map(m => [m.id, (m.display_name || m.email || 'Pilot') + (m.approval_status === 'removed' ? ' (eliminat)' : '')]));
    names.set(user.id, profile.display_name || user.email || 'Jo');
    const crafts = new Map(aircraft.map(a => [a.id, a.model]));
    return {
      user, profile, flights, aircraft, team, reload,
      isAdmin: profile.role === 'admin' && profile.approval_status === 'approved',
      nameOf: id => names.get(id) ?? 'Pilot',
      craftName: f => (f.aircraft_id && crafts.get(f.aircraft_id)) || f.aircraft || 'Sense aeronau',
    };
  }, [user, profile, flights, aircraft, team, reload]);

  const approved = profile?.approval_status === 'approved';
  usePresence(approved);
  const effectiveView: View = view === 'equip' && !data?.isAdmin ? 'tauler' : view;
  const userName = profile?.display_name || user.email || 'Pilot';
  const go = (target: View) => { window.location.hash = target; };

  return <>
    <header className="top">
      <div className="wrap">
        <div className="topbar">
          <Brand />
          <div className="who">
            {approved && <ProfilePhoto userId={user.id} name={userName} />}
            <div><div className="name">{userName}</div><div className="role">{data?.isAdmin ? 'Administrador/a' : approved ? 'Pilot' : ''}</div></div>
            <button type="button" className="small" onClick={() => void supabase.auth.signOut()}>Surt</button>
          </div>
        </div>
        {approved && <nav className="tabs" aria-label="Seccions">
          {VIEWS.filter(v => v !== 'equip' || data?.isAdmin).map(v => <a key={v} href={'#' + v} aria-current={effectiveView === v ? 'page' : undefined}>
            {{ tauler: 'Tauler', registra: editing ? 'Edita el vol' : 'Registra un vol', historial: 'Historial', terrats: 'Terrats', 'copia-de-seguretat': 'Còpia de seguretat', equip: 'Equip', flota: 'Flota' }[v]}
            {v === 'equip' && team.some(m => m.approval_status === 'pending') && <span className="dot" aria-label="Hi ha sol·licituds pendents" />}
          </a>)}
        </nav>}
      </div>
    </header>
    <main className="wrap">
      {loading ? <p role="status">Carregant…</p>
        : problem ? <div className="panel"><p className="err">{problem}</p><div><button onClick={reload}>Torna-ho a provar</button></div></div>
        : !profile || !data ? null
        : !approved ? <div className="panel">
          <h2>{profile.approval_status === 'pending' ? 'Alta rebuda' : 'Estat del compte'}</h2>
          {profile.approval_status === 'pending' && <p className="ok">El teu correu està confirmat i la teva sol·licitud ja ha arribat a l'administració.</p>}
          <p>{profile.approval_status === 'pending' ? 'Quan l’administració t’autoritzi, podràs entrar i registrar vols. No cal que tornis a donar-te d’alta: només has de tornar a entrar més tard o prémer «Torna a comprovar».' : 'El teu compte està bloquejat. Contacta amb l’administració.'}</p>
          <div><button onClick={reload}>Torna a comprovar</button></div>
        </div>
        : <>
          {effectiveView === 'tauler' && <Dashboard data={data} />}
          {effectiveView === 'registra' && <FlightForm data={data} editing={editing} onDone={() => { setEditing(null); go('historial'); }} />}
          {effectiveView === 'historial' && <History data={data} initialPilot={pilotFilter} onEdit={flight => { setEditing(flight); go('registra'); }} />}
          {effectiveView === 'copia-de-seguretat' && <FlightBackup data={data} />}
          {effectiveView === 'equip' && <Team data={data} onOpenPilot={id => { setPilotFilter(id); go('historial'); }} />}
          {effectiveView === 'flota' && <Fleet data={data} />}
          {effectiveView === 'terrats' && <Rooftops data={data} />}
        </>}
    </main>
  </>;
}
