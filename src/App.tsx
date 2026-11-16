import { useEffect, useState, type FormEvent } from 'react';
import type { User } from '@supabase/supabase-js';
import { supabase } from './lib/supabase';

type Flight = { id: string; flight_date: string; aircraft: string; duration_minutes: number; notes: string | null; pilot_id: string };
type Profile = { id: string; display_name: string; role: 'pilot' | 'admin' };

export function App() {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [flights, setFlights] = useState<Flight[]>([]);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [date, setDate] = useState(new Date().toLocaleDateString('en-CA'));
  const [aircraft, setAircraft] = useState('');
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
      if (p.error || f.error) { setMessage(p.error?.message || f.error?.message || 'Error'); return; }
      setProfile(p.data as Profile);
      setFlights(f.data as Flight[]);
    }
    void load();
    return () => { active = false; };
  }, [user]);

  async function signIn(e: FormEvent) {
    e.preventDefault(); setBusy(true); setMessage('');
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setMessage('No se pudo iniciar sesión. Comprueba las credenciales.');
    setPassword(''); setBusy(false);
  }

  async function addFlight(e: FormEvent) {
    e.preventDefault(); if (!user) return;
    const duration = Number(minutes);
    if (!Number.isInteger(duration) || duration < 1 || duration > 1440 || !aircraft.trim()) { setMessage('Revisa la aeronave y la duración.'); return; }
    setBusy(true); setMessage('');
    const { data, error } = await supabase.from('flights').insert({ pilot_id: user.id, flight_date: date, aircraft: aircraft.trim(), duration_minutes: duration, notes: notes.trim() || null }).select('id,flight_date,aircraft,duration_minutes,notes,pilot_id').single();
    if (error) setMessage(error.message);
    else { setFlights(old => [data as Flight, ...old]); setAircraft(''); setMinutes(''); setNotes(''); setMessage('Vuelo registrado.'); }
    setBusy(false);
  }

  const hours = (n: number) => (n / 60).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' h';
  if (!user) return <main><h1>INVALL · Control de vuelos</h1><section><h2>Acceso de pilotos</h2><p>Acceso mediante cuenta creada por el administrador.</p><form onSubmit={signIn}><label>Correo<input type="email" autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} required /></label><label>Contraseña<input type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required /></label><button disabled={busy}>Entrar</button></form>{message && <p role="status">{message}</p>}</section></main>;
  return <main><header><div><h1>INVALL · Control de vuelos</h1><p>{profile?.display_name || user.email} · {profile?.role === 'admin' ? 'Administrador' : 'Piloto'}</p></div><button onClick={() => void supabase.auth.signOut()}>Cerrar sesión</button></header><section><h2>{profile?.role === 'admin' ? 'Todos los vuelos' : 'Mis vuelos'}</h2><div className="stats"><div><strong>{flights.length}</strong><span>Vuelos</span></div><div><strong>{hours(flights.reduce((n, f) => n + f.duration_minutes, 0))}</strong><span>Horas acumuladas</span></div></div></section><section><h2>Registrar mi vuelo</h2><form onSubmit={addFlight}><label>Fecha<input type="date" value={date} onChange={e => setDate(e.target.value)} required /></label><label>Aeronave<input value={aircraft} onChange={e => setAircraft(e.target.value)} maxLength={100} required /></label><label>Duración (minutos)<input type="number" min="1" max="1440" step="1" value={minutes} onChange={e => setMinutes(e.target.value)} required /></label><label>Observaciones<textarea value={notes} onChange={e => setNotes(e.target.value)} maxLength={500} /></label><button disabled={busy}>Guardar vuelo</button></form></section>{message && <p role="status">{message}</p>}<section><h2>Historial</h2><div className="tablewrap"><table><thead><tr><th>Fecha</th>{profile?.role === 'admin' && <th>ID piloto</th>}<th>Aeronave</th><th>Duración</th><th>Notas</th></tr></thead><tbody>{flights.map(f => <tr key={f.id}><td>{f.flight_date}</td>{profile?.role === 'admin' && <td>{f.pilot_id}</td>}<td>{f.aircraft}</td><td>{hours(f.duration_minutes)}</td><td>{f.notes || '—'}</td></tr>)}</tbody></table></div></section></main>;
}
