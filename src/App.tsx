import { useEffect, useState, type FormEvent } from 'react';
import type { User } from '@supabase/supabase-js';
import { supabase } from './lib/supabase';
import { ProfilePhoto } from './ProfilePhoto';
import {
  formatDuration, loadFlights, loadPilots, loadProfile, summarizeFlights,
  type ApprovalStatus, type Flight, type Pilot, type Profile,
} from './flight-data';

const aircraftOptions = ['DJI 3T', 'DJI 4T', 'DJI 30T', 'DJI 300', 'DJI 400', 'DJI Avata', 'DJI Avata 2', 'Ala fixa Quantum'];
const accountsSectionId = 'comptes-de-pilots';
const personalSectionId = 'els-meus-vols';
const excelSectionId = 'excel';

function currentSection() {
  return window.location.hash.slice(1);
}
const statusLabels = { approved: 'Aprovat', pending: 'Pendent', blocked: 'Bloquejat' };

export function App() {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      setReady(true);
    });
    return () => subscription.unsubscribe();
  }, []);

  if (!ready) return <main><h1>Udrón · Control de vols</h1><p role="status">Carregant…</p></main>;
  return user ? <FlightAccount key={user.id} user={user} /> : <AccessForm />;
}

function AccessForm() {
  const [registration, setRegistration] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      if (registration) {
        if (!name.trim()) {
          setMessage('Introdueix el teu nom.');
          return;
        }
        const { error } = await supabase.auth.signUp({
          email: email.trim(), password,
          options: { data: { display_name: name.trim() }, emailRedirectTo: window.location.origin + import.meta.env.BASE_URL },
        });
        if (error) {
          setMessage(error.code === 'signup_disabled'
            ? 'El registre encara no està obert.'
            : 'No s’ha pogut tramitar el registre. Revisa les dades o torna-ho a provar més tard.');
        } else {
          setRegistration(false);
          setMessage('Revisa el correu per confirmar el compte. Després, l’administrador haurà d’aprovar la sol·licitud.');
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error) setMessage(error.code === 'email_not_confirmed'
          ? 'Confirma el correu electrònic abans d’iniciar la sessió.'
          : 'No s’ha pogut iniciar la sessió. Comprova el correu i la contrasenya.');
      }
    } catch {
      setMessage('No s’ha pogut connectar amb Udrón. Torna-ho a provar.');
    } finally {
      setPassword('');
      setBusy(false);
    }
  }

  return <main>
    <h1>Udrón · Control de vols</h1>
    <section>
      <h2>{registration ? 'Sol·licita un compte de pilot' : 'Accés de pilots'}</h2>
      <form onSubmit={submit}>
        {registration && <label>Nom i cognoms<input autoComplete="name" value={name} onChange={e => setName(e.target.value)} maxLength={120} required /></label>}
        <label>Correu electrònic<input type="email" autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} required /></label>
        <label>Contrasenya<input type="password" autoComplete={registration ? 'new-password' : 'current-password'} minLength={registration ? 8 : undefined} value={password} onChange={e => setPassword(e.target.value)} required /></label>
        <button disabled={busy}>{registration ? 'Envia la sol·licitud' : 'Inicia la sessió'}</button>
      </form>
      <p><button type="button" disabled={busy} onClick={() => { setRegistration(!registration); setPassword(''); setMessage(''); }}>
        {registration ? 'Torna a l’inici de sessió' : 'Crea un compte'}
      </button></p>
      {message && <p role="status">{message}</p>}
    </section>
  </main>;
}

function FlightAccount({ user }: { user: User }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [approvalsReady, setApprovalsReady] = useState(false);
  const [flights, setFlights] = useState<Flight[]>([]);
  const [pilots, setPilots] = useState<Pilot[]>([]);
  const [date, setDate] = useState(() => new Date().toLocaleDateString('en-CA'));
  const [aircraftType, setAircraftType] = useState('');
  const [aircraftModel, setAircraftModel] = useState('');
  const [minutes, setMinutes] = useState('');
  const [notes, setNotes] = useState('');
  const [message, setMessage] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [section, setSection] = useState(currentSection);
  const adminRequested = section === accountsSectionId;
  const excelView = section === excelSectionId;
  const [loadedAdminRequest, setLoadedAdminRequest] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [pilotBusy, setPilotBusy] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const followHash = () => setSection(currentSection());
    window.addEventListener('hashchange', followHash);
    return () => window.removeEventListener('hashchange', followHash);
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setNotice('');

    async function load() {
      try {
        const { profile: current, approvalsReady: canReview } = await loadProfile(user.id);
        const team = adminRequested && current.role === 'admin';
        const [rows, accounts] = current.approval_status === 'approved'
          ? await Promise.all([loadFlights(team ? undefined : user.id), team ? loadPilots(canReview) : []])
          : [[], []];
        if (active) {
          setProfile(current);
          setApprovalsReady(canReview);
          setFlights(rows);
          setPilots(accounts);
        }
      } catch {
        if (active) {
          setProfile(null);
          setFlights([]);
          setPilots([]);
          setNotice('No s’han pogut carregar les dades. Torna-ho a provar.');
        }
      } finally {
        if (active) {
          setLoadedAdminRequest(adminRequested);
          setLoading(false);
        }
      }
    }
    void load();
    return () => { active = false; };
  }, [user.id, reload, adminRequested]);

  const approved = profile?.approval_status === 'approved';
  const admin = approved && profile.role === 'admin';

  const adminView = admin && adminRequested;
  const viewLoading = loading || loadedAdminRequest !== adminRequested;
  const userName = profile?.display_name || user.email || 'Pilot';
  const pilotNames = new Map(pilots.map(pilot => [pilot.id, pilot.display_name || pilot.email || pilot.id]));
  pilotNames.set(user.id, userName);
  const totalMinutes = flights.reduce((sum, row) => sum + row.duration_minutes, 0);

  async function addFlight(event: FormEvent) {
    event.preventDefault();
    const duration = Number(minutes);
    const aircraft = aircraftType === 'other' ? aircraftModel.trim() : aircraftType;
    if (!Number.isInteger(duration) || duration < 1 || duration > 1440 || !aircraft || aircraft.length > 100) {
      setMessage('Revisa l’aeronau i la durada.');
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      const { error } = await supabase.from('flights')
        .insert({ pilot_id: user.id, flight_date: date, aircraft, duration_minutes: duration, notes: notes.trim() || null });
      if (error) throw error;
      setReload(value => value + 1);
      setAircraftType('');
      setAircraftModel('');
      setMinutes('');
      setNotes('');
      setMessage('Vol registrat.');
    } catch {
      setMessage('No s’ha pogut desar el vol.');
    } finally {
      setBusy(false);
    }
  }

  async function updatePilot(pilot: Pilot, status: ApprovalStatus) {
    setPilotBusy(pilot.id);
    setNotice('');
    try {
      const { error } = await supabase.rpc('set_pilot_approval', { target_id: pilot.id, new_status: status });
      if (error) throw error;
      setPilots(previous => previous.map(item => item.id === pilot.id ? { ...item, approval_status: status } : item));
      setNotice(status === 'approved' ? 'Compte aprovat.' : 'Compte bloquejat.');
    } catch {
      setNotice('No s’ha pogut canviar l’estat del compte.');
    } finally {
      setPilotBusy(null);
    }
  }

  async function exportExcel(pilotId?: string) {
    setExporting(true);
    setNotice('');
    try {
      const [{ createFlightWorkbook }, rows, accounts] = await Promise.all([
        import('./flight-export'), loadFlights(adminView ? pilotId : user.id), adminView ? loadPilots(approvalsReady) : [],
      ]);
      const names = new Map(accounts.map(pilot => [pilot.id, pilot.display_name || pilot.email || pilot.id]));
      names.set(user.id, userName);
      const workbook = await createFlightWorkbook(rows, pilotId ? new Map([[pilotId, names.get(pilotId) ?? pilotId]]) : names);
      const link = document.createElement('a');
      const url = URL.createObjectURL(new Blob([workbook], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
      link.href = url;
      link.download = 'Udrón-llibre-de-vols.xlsx';
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch {
      setNotice('No s’ha pogut exportar el llibre de vols.');
    } finally {
      setExporting(false);
    }
  }

  return <main>
    <header>
      <div>
        <h1>Udrón · Control de vols</h1>
        <p>{userName}{approved ? (adminView ? ' · Administrador' : ' · Pilot') : ''}</p>
        {approved && <ProfilePhoto userId={user.id} name={userName} />}
      </div>
      <nav className="actions account-navigation" aria-label="Compte">
        {approved && <>
          <a href={'#' + personalSectionId} aria-current={!adminView && !excelView ? 'page' : undefined}>Els meus vols</a>
          <a href={'#' + excelSectionId} aria-current={excelView ? 'page' : undefined}>Excel</a>
          {admin && <a href={'#' + accountsSectionId} aria-current={adminView ? 'page' : undefined}>Administració</a>}
        </>}
        <button onClick={() => void supabase.auth.signOut()}>Tanca la sessió</button>
      </nav>
    </header>
    {viewLoading ? <p role="status">Carregant…</p> : !approved ? <section>
      <h2>{profile ? 'Estat del compte' : 'Accés al llibre de vols'}</h2>
      {profile && <p>{profile.approval_status === 'pending'
        ? 'La teva sol·licitud està pendent d’aprovació.'
        : 'El teu compte està bloquejat. Contacta amb l’administrador.'}</p>}
      <button onClick={() => setReload(value => value + 1)}>Torna a comprovar</button>
    </section> : <>
      {adminView && <section id={accountsSectionId} aria-labelledby="comptes-de-pilots-titol">
        <h2 id="comptes-de-pilots-titol">Comptes de pilots</h2>
        {!approvalsReady ? <p>Falta aplicar la migració d’aprovació a Supabase.</p> : pilots.length === 0 ? <p>Encara no hi ha cap sol·licitud de pilot.</p> : <div className="tablewrap"><table>
          <thead><tr><th>Pilot</th><th>Correu electrònic</th><th>Estat</th><th>Accés</th></tr></thead>
          <tbody>{pilots.map(pilot => <tr key={pilot.id}>
            <td>{pilot.display_name || '—'}</td><td>{pilot.email || '—'}</td>
            <td>{statusLabels[pilot.approval_status]}{!pilot.email_confirmed && ' · Correu sense confirmar'}</td>
            <td><div className="actions">{pilot.approval_status === 'approved'
              ? <button disabled={pilotBusy !== null} onClick={() => void updatePilot(pilot, 'blocked')}>Bloqueja</button>
              : <button disabled={pilotBusy !== null || !pilot.email_confirmed} onClick={() => void updatePilot(pilot, 'approved')}>{pilot.approval_status === 'blocked' ? 'Reactiva' : 'Aprova'}</button>}{pilot.approval_status === 'pending' && <button disabled={pilotBusy !== null} onClick={() => void updatePilot(pilot, 'blocked')}>Bloqueja</button>}</div></td>
          </tr>)}</tbody>
        </table></div>}
      </section>}
      <section id={adminView ? undefined : excelView ? excelSectionId : personalSectionId}>
        <h2>{adminView ? 'Tots els vols' : excelView ? 'Exporta el llibre de vols a Excel' : 'Els meus vols'}</h2>
        {excelView && <p>Descarrega els teus vols i el total d’hores en un fitxer .xlsx.</p>}
        <div className="stats">
          <div><strong>{flights.length}</strong><span>Vols</span></div>
          <div><strong>{formatDuration(totalMinutes)}</strong><span>Hores acumulades</span></div>
        </div>
        <div className="actions">
          {(adminView || excelView) && <button onClick={() => void exportExcel()} disabled={exporting}>{exporting ? 'Preparant Excel…' : 'Descarrega Excel'}</button>}
          <button onClick={() => setReload(value => value + 1)}>Actualitza</button>
        </div>
      </section>
      {adminView && <section>
        <h2>Hores per pilot</h2>
        <div className="tablewrap"><table>
          <thead><tr><th>Pilot</th><th>Vols</th><th>Hores totals</th><th>Excel</th></tr></thead>
          <tbody>{summarizeFlights(flights, pilotNames).map(total => <tr key={total.id}>
            <td>{total.name}</td><td>{total.count}</td><td>{formatDuration(total.minutes)}</td>
            <td><button disabled={exporting} onClick={() => void exportExcel(total.id)} aria-label={'Descarrega Excel de ' + total.name}>Descarrega</button></td>
          </tr>)}</tbody>
        </table></div>
      </section>}
      {!adminView && !excelView && <section>
        <h2>Registra un vol</h2>
        <form onSubmit={addFlight}>
          <label>Data<input type="date" value={date} onChange={e => setDate(e.target.value)} required /></label>
          <label>Tipus d’aeronau<select value={aircraftType} onChange={e => setAircraftType(e.target.value)} required>
            <option value="">Selecciona un tipus</option>
            {aircraftOptions.map(option => <option key={option}>{option}</option>)}
            <option value="other">Una altra aeronau</option>
          </select></label>
          {aircraftType === 'other' && <label>Marca i model<input value={aircraftModel} onChange={e => setAircraftModel(e.target.value)} maxLength={100} required /></label>}
          <label>Durada (minuts)<input type="number" min="1" max="1440" step="1" value={minutes} onChange={e => setMinutes(e.target.value)} required /></label>
          <label>Observacions<textarea value={notes} onChange={e => setNotes(e.target.value)} maxLength={500} /></label>
          <button disabled={busy}>Desa el vol</button>
        </form>
        {message && <p role="status">{message}</p>}
      </section>}
      {!excelView && <section>
        <h2>Historial</h2>
        <div className="tablewrap"><table>
          <thead><tr><th>Data</th>{adminView && <th>Pilot</th>}<th>Aeronau</th><th>Durada</th><th>Notes</th></tr></thead>
          <tbody>{flights.map(flight => <tr key={flight.id}>
            <td>{flight.flight_date}</td>
            {adminView && <td>{pilotNames.get(flight.pilot_id) ?? flight.pilot_id}</td>}
            <td>{flight.aircraft}</td><td>{formatDuration(flight.duration_minutes)}</td><td>{flight.notes || '—'}</td>
          </tr>)}</tbody>
        </table></div>
      </section>}
    </>}
    {notice && <p role="status">{notice}</p>}
  </main>;
}
