import { useEffect, useState, type FormEvent } from 'react';
import type { User } from '@supabase/supabase-js';
import { supabase } from './lib/supabase';

const aircraftOptions = ["DJI 3T","DJI 4T","DJI 30T","DJI 300","DJI 400","DJI Avata","DJI Avata 2","Ala fixa Quantum"];

type Flight = { id: string; flight_date: string; aircraft: string; duration_minutes: number; notes: string | null; pilot_id: string };
type Profile = { id: string; display_name: string; role: 'pilot' | 'admin' };

export function App() {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [flights, setFlights] = useState<Flight[]>([]);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [date, setDate] = useState(new Date().toLocaleDateString('en-CA'));
  const [aircraftType, setAircraftType] = useState('');
  const [aircraftModel, setAircraftModel] = useState('');
  const [minutes, setMinutes] = useState('');
  const [notes, setNotes] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    supabase.auth.getUser().then(({ data }) => { if (active) setUser(data.user); });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => setUser(session?.user ?? null));
    return () => { active = false; subscription.unsubscribe(); };
  }, []);

  useEffect(() => {
    if (!user) { setProfile(null); setFlights([]); return; }
    let active = true;
    async function load() {
      const [p, f] = await Promise.all([
        supabase.from('profiles').select('id,display_name,role').eq('id', user!.id).single(),
        supabase.from('flights').select('id,flight_date,aircraft,duration_minutes,notes,pilot_id').order('flight_date', { ascending: false })
      ]);
      if (!active) return;
      if (p.error || f.error) { setMessage('No s’han pogut carregar les dades.'); return; }
      setProfile(p.data as Profile);
      setFlights(f.data as Flight[]);
    }
    void load();
    return () => { active = false; };
  }, [user]);

  async function signIn(e: FormEvent) {
    e.preventDefault(); setBusy(true); setMessage('');
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setMessage('No s’ha pogut iniciar la sessió. Comprova el correu i la contrasenya.');
    setPassword(''); setBusy(false);
  }

  async function addFlight(e: FormEvent) {
    e.preventDefault(); if (!user) return;
    const duration = Number(minutes);
    const model = aircraftModel.trim();
    const aircraft = aircraftType === 'other' ? model : aircraftType;
    if (!Number.isInteger(duration) || duration < 1 || duration > 1440 || !aircraftType || !aircraft || aircraft.length > 100) { setMessage('Revisa l’aeronau i la durada.'); return; }
    setBusy(true); setMessage('');
    const { data, error } = await supabase.from('flights').insert({ pilot_id: user.id, flight_date: date, aircraft, duration_minutes: duration, notes: notes.trim() || null }).select('id,flight_date,aircraft,duration_minutes,notes,pilot_id').single();
    if (error) setMessage('No s’ha pogut desar el vol.');
    else { setFlights(old => [data as Flight, ...old]); setAircraftType(''); setAircraftModel(''); setMinutes(''); setNotes(''); setMessage('Vol registrat.'); }
    setBusy(false);
  }

  const hours = (n: number) => (n / 60).toLocaleString('ca-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' h';
  if (!user) return <main><h1>INVALL · Control de vols</h1><section><h2>Accés de pilots</h2><p>Inicia la sessió amb el compte creat per l’administrador.</p><form onSubmit={signIn}><label>Correu electrònic<input type="email" autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} required /></label><label>Contrasenya<input type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required /></label><button disabled={busy}>Inicia la sessió</button></form>{message && <p role="status">{message}</p>}</section></main>;
  return <main><header><div><h1>INVALL · Control de vols</h1><p>{profile?.display_name || user.email} · {profile?.role === 'admin' ? 'Administrador' : 'Pilot'}</p></div><button onClick={() => void supabase.auth.signOut()}>Tanca la sessió</button></header><section><h2>{profile?.role === 'admin' ? 'Tots els vols' : 'Els meus vols'}</h2><div className="stats"><div><strong>{flights.length}</strong><span>Vols</span></div><div><strong>{hours(flights.reduce((n, f) => n + f.duration_minutes, 0))}</strong><span>Hores acumulades</span></div></div></section><section><h2>Registra un vol</h2><form onSubmit={addFlight}><label>Data<input type="date" value={date} onChange={e => setDate(e.target.value)} required /></label><label>Tipus d’aeronau<select value={aircraftType} onChange={e => setAircraftType(e.target.value)} required><option value="">Selecciona un tipus</option>{aircraftOptions.map(option => <option key={option} value={option}>{option}</option>)}<option value="other">Una altra aeronau</option></select></label>{aircraftType === 'other' && <label>Marca i model<input value={aircraftModel} onChange={e => setAircraftModel(e.target.value)} maxLength={100} required /></label>}<label>Durada (minuts)<input type="number" min="1" max="1440" step="1" value={minutes} onChange={e => setMinutes(e.target.value)} required /></label><label>Observacions<textarea value={notes} onChange={e => setNotes(e.target.value)} maxLength={500} /></label><button disabled={busy}>Desa el vol</button></form></section>{message && <p role="status">{message}</p>}<section><h2>Historial</h2><div className="tablewrap"><table><thead><tr><th>Data</th>{profile?.role === 'admin' && <th>ID del pilot</th>}<th>Aeronau</th><th>Durada</th><th>Notes</th></tr></thead><tbody>{flights.map(f => <tr key={f.id}><td>{f.flight_date}</td>{profile?.role === 'admin' && <td>{f.pilot_id}</td>}<td>{f.aircraft}</td><td>{hours(f.duration_minutes)}</td><td>{f.notes || '—'}</td></tr>)}</tbody></table></div></section></main>;
}
