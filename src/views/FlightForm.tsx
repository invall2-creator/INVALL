import { useEffect, useState, type FormEvent } from 'react';
import type { AppData } from '../context';
import { CATEGORIES, MISSIONS, type Flight } from '../flight-data';
import { fmtDate, fmtHM, fmtHours, minutesBetween, parseClock, parseDuration, todayISO } from '../format';
import { supabase } from '../lib/supabase';

type Fields = {
  flight_date: string; start_time: string; end_time: string; duration: string; aircraft_id: string; new_aircraft?: string;
  place: string; mission: string; category: string; light: 'dia' | 'nit'; crew_role: 'pilot' | 'observador';
  takeoffs: string; incident: boolean; incident_text: string; notes: string;
};
const DRAFT_KEY = 'udron-esborrany-vol';
const NEW_CRAFT = '__nova__';

const empty = (): Fields => ({
  flight_date: todayISO(), start_time: '', end_time: '', duration: '', aircraft_id: '', place: '', mission: '',
  category: '', light: 'dia', crew_role: 'pilot', takeoffs: '1', incident: false, incident_text: '', notes: '',
});
const fromFlight = (f: Flight): Fields => ({
  flight_date: f.flight_date, start_time: f.start_time ?? '', end_time: f.end_time ?? '', duration: fmtHM(f.duration_minutes),
  aircraft_id: f.aircraft_id ?? '', place: f.place ?? '', mission: f.mission ?? '', category: f.category ?? '',
  light: f.light, crew_role: f.crew_role, takeoffs: String(f.takeoffs || 1), incident: f.incident,
  incident_text: f.incident_text ?? '', notes: f.notes ?? '',
});
function readDraft(): Fields {
  try {
    const saved = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? 'null') as Partial<Fields> | null;
    if (saved) return { ...empty(), ...saved };
  } catch { /* draft is a convenience only */ }
  return empty();
}

export function FlightForm({ data, editing, onDone }: { data: AppData; editing: Flight | null; onDone: () => void }) {
  const [fields, setFields] = useState<Fields>(() => editing ? fromFlight(editing) : readDraft());
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const [busy, setBusy] = useState(false);
  const usable = data.aircraft.filter(a => a.status !== 'baixa' || a.id === editing?.aircraft_id);
  const places = [...new Set(data.flights.map(f => f.place).filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b, 'ca'));

  useEffect(() => { setFields(editing ? fromFlight(editing) : readDraft()); setReason(''); setError(''); setOk(''); }, [editing]);
  useEffect(() => {
    if (editing) return;
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify(fields)); } catch { /* ignore */ }
  }, [fields, editing]);

  function set<K extends keyof Fields>(key: K, value: Fields[K]) {
    setFields(prev => {
      const next = { ...prev, [key]: value };
      if (key === 'start_time' || key === 'end_time') {
        const start = parseClock(next.start_time ?? '', true), end = parseClock(next.end_time ?? '', true);
        const minutes = start && end ? minutesBetween(start, end) : null;
        if (minutes) next.duration = fmtHM(minutes);
      }
      return next;
    });
  }

  function validate(minutes: number | null) {
    if (!fields.flight_date) return 'Indica la data del vol.';
    if (fields.start_time?.trim() && !parseClock(fields.start_time)) return "L'hora d'inici no és vàlida. Escriu-la com 10:15.";
    if (fields.end_time?.trim() && !parseClock(fields.end_time)) return "L'hora de final no és vàlida. Escriu-la com 11:02.";
    if (fields.flight_date > todayISO()) return 'La data no pot ser posterior a avui.';
    if (minutes === null || Number.isNaN(minutes)) return "Indica el temps total de vol (h:mm o minuts).";
    if (minutes < 1 || minutes > 1440) return 'La durada ha d’estar entre 1 minut i 24 hores.';
    if (fields.aircraft_id === NEW_CRAFT && !fields.new_aircraft?.trim()) return "Escriu la marca i el model de l'aeronau nova.";
    if (!fields.aircraft_id && !editing?.aircraft) return "Tria l'aeronau.";
    if (!fields.mission) return 'Tria el tipus de servei.';
    if (fields.incident && !fields.incident_text.trim()) return 'Descriu breument la incidència.';
    if (editing && !reason.trim()) return 'Explica el motiu del canvi.';
    return '';
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setOk('');
    const start = parseClock(fields.start_time ?? ''), end = parseClock(fields.end_time ?? '');
    const minutes = start && end ? minutesBetween(start, end) : parseDuration(fields.duration);
    const problem = validate(minutes);
    setError(problem);
    if (problem || minutes === null) return;
    setBusy(true);
    let aircraftId = fields.aircraft_id;
    if (aircraftId === NEW_CRAFT) {
      const model = (fields.new_aircraft ?? '').trim().replace(/\s+/g, ' ');
      const existing = data.aircraft.find(a => a.model.toLocaleLowerCase('ca') === model.toLocaleLowerCase('ca'));
      if (existing) aircraftId = existing.id;
      else {
        const { data: created, error: craftError } = await supabase.from('aircraft')
          .insert({ model, sort_order: Math.max(0, ...data.aircraft.map(a => a.sort_order)) + 1 }).select('id').single();
        if (craftError || !created) { setBusy(false); setError("No s'ha pogut afegir l'aeronau nova. Torna-ho a provar."); return; }
        aircraftId = created.id as string;
        data.reload();
      }
      setFields(prev => ({ ...prev, aircraft_id: aircraftId, new_aircraft: '' }));
    }
    const craft = data.aircraft.find(a => a.id === aircraftId);
    const newModel = fields.aircraft_id === NEW_CRAFT ? (fields.new_aircraft ?? '').trim() : '';
    const row = {
      flight_date: fields.flight_date, start_time: start, end_time: end,
      duration_minutes: minutes, aircraft_id: aircraftId || null, aircraft: craft?.model ?? (newModel || editing?.aircraft) ?? '',
      place: fields.place.trim() || null, mission: fields.mission, category: fields.category || null, light: fields.light,
      crew_role: fields.crew_role, takeoffs: Math.min(99, Math.max(1, Math.round(Number(fields.takeoffs) || 1))),
      incident: fields.incident, incident_text: fields.incident ? fields.incident_text.trim() : null, notes: fields.notes.trim() || null,
    };
    try {
      if (editing) {
        const { data: saved, error: rpcError } = await supabase.rpc('update_flight', { target_id: editing.id, patch: row, change_reason: reason.trim() });
        if (rpcError) throw rpcError;
        if (!saved) { setError('Aquest vol ja no es pot editar (potser s’ha eliminat).'); return; }
        data.reload();
        onDone();
      } else {
        const { error: insertError } = await supabase.from('flights').insert({ ...row, pilot_id: data.user.id });
        if (insertError) throw insertError;
        setOk(`Vol desat: ${fmtHours(minutes)} amb ${row.aircraft}.`);
        setFields({ ...empty(), flight_date: fields.flight_date, aircraft_id: aircraftId, mission: fields.mission, category: fields.category, place: fields.place });
        data.reload();
      }
    } catch (e) {
      const message = (e as { message?: string }).message ?? '';
      setError(/posterior/.test(message) ? 'La data no pot ser posterior a avui.' : "No s'ha pogut desar. Revisa la connexió i torna-ho a provar; l'esborrany es manté.");
    } finally {
      setBusy(false);
    }
  }

  const id = (name: string) => 'vol-' + name;
  return <section className="view" aria-labelledby="registra-titol">
    <form className="panel" onSubmit={submit} noValidate>
      <div className="view-head">
        <h2 id="registra-titol">{editing ? `Edita el vol del ${fmtDate(editing.flight_date)}` : 'Registra un vol'}</h2>
        {!editing && <span className="hint">L'esborrany es desa en aquest dispositiu</span>}
      </div>
      <p className="hint">Només cal el temps total de vol. Si poses l'hora d'inici i la de final, el temps es calcula sol.</p>
      <div className="form">
        <label htmlFor={id('data')}>Data<input id={id('data')} type="date" max={todayISO()} value={fields.flight_date} onChange={e => set('flight_date', e.target.value)} required /></label>
        <label htmlFor={id('inici')}><span>Hora d'inici <span className="opt">(opcional)</span></span><input id={id('inici')} inputMode="numeric" autoComplete="off" placeholder="p. ex. 10:15" maxLength={5} value={fields.start_time} onChange={e => set('start_time', e.target.value)} onBlur={e => { const t = parseClock(e.target.value); if (t) set('start_time', t); }} /></label>
        <label htmlFor={id('fi')}><span>Hora de final <span className="opt">(opcional)</span></span><input id={id('fi')} inputMode="numeric" autoComplete="off" placeholder="p. ex. 11:02" maxLength={5} value={fields.end_time} onChange={e => set('end_time', e.target.value)} onBlur={e => { const t = parseClock(e.target.value); if (t) set('end_time', t); }} /></label>
        <label htmlFor={id('durada')}>Temps total de vol (h:mm)<input id={id('durada')} inputMode="numeric" placeholder="p. ex. 0:35" value={fields.duration} onChange={e => set('duration', e.target.value)} readOnly={!!(parseClock(fields.start_time ?? '') && parseClock(fields.end_time ?? ''))} />
          {parseClock(fields.start_time ?? '') && parseClock(fields.end_time ?? '') && <span className="opt">Calculat a partir de les hores</span>}</label>
        <label className="span-2" htmlFor={id('aeronau')}>Aeronau
          <select id={id('aeronau')} value={fields.aircraft_id} onChange={e => set('aircraft_id', e.target.value)} required>
            <option value="">{editing && !editing.aircraft_id ? editing.aircraft : "Tria l'aeronau"}</option>
            {usable.map(a => <option key={a.id} value={a.id}>{a.model}{a.status === 'manteniment' ? ' (en manteniment)' : ''}</option>)}
            <option value={NEW_CRAFT}>+ Una altra aeronau…</option>
          </select>
        </label>
        {fields.aircraft_id === NEW_CRAFT && <label className="span-2" htmlFor={id('aeronau-nova')}>Marca i model de l'aeronau nova
          <input id={id('aeronau-nova')} maxLength={100} placeholder="p. ex. DJI Matrice 350 RTK" value={fields.new_aircraft ?? ''} onChange={e => set('new_aircraft', e.target.value)} autoFocus />
          <span className="opt">S'afegirà a la flota i la podrà triar tothom</span>
        </label>}
        <label className="span-2" htmlFor={id('lloc')}>Lloc o municipi<input id={id('lloc')} list="llocs" maxLength={120} placeholder="p. ex. Montserrat" value={fields.place} onChange={e => set('place', e.target.value)} /></label>
        <datalist id="llocs">{places.map(p => <option key={p} value={p} />)}</datalist>
        <label htmlFor={id('servei')}>Tipus de servei
          <select id={id('servei')} value={fields.mission} onChange={e => set('mission', e.target.value)} required>
            <option value="">Tria el servei</option>
            {MISSIONS.map(m => <option key={m}>{m}</option>)}
            {fields.mission && !MISSIONS.includes(fields.mission) && <option>{fields.mission}</option>}
          </select>
        </label>
        <label htmlFor={id('categoria')}>Categoria d'operació
          <select id={id('categoria')} value={fields.category} onChange={e => set('category', e.target.value)}>
            <option value="">—</option>{CATEGORIES.map(c => <option key={c}>{c}</option>)}
          </select>
        </label>
        <label htmlFor={id('llum')}>Condicions
          <select id={id('llum')} value={fields.light} onChange={e => set('light', e.target.value as Fields['light'])}>
            <option value="dia">Diürn</option><option value="nit">Nocturn</option>
          </select>
        </label>
        <label htmlFor={id('funcio')}>Funció
          <select id={id('funcio')} value={fields.crew_role} onChange={e => set('crew_role', e.target.value as Fields['crew_role'])}>
            <option value="pilot">Pilot al comandament</option><option value="observador">Observador</option>
          </select>
        </label>
        <label htmlFor={id('enlairaments')}>Enlairaments<input id={id('enlairaments')} type="number" min={1} max={99} step={1} value={fields.takeoffs} onChange={e => set('takeoffs', e.target.value)} /></label>
        <label className="span-2 check" htmlFor={id('incidencia')}><input id={id('incidencia')} type="checkbox" checked={fields.incident} onChange={e => set('incident', e.target.checked)} /> Hi ha hagut una incidència</label>
        {fields.incident && <label className="span-4" htmlFor={id('incidencia-text')}>Descripció de la incidència<textarea id={id('incidencia-text')} maxLength={800} value={fields.incident_text} onChange={e => set('incident_text', e.target.value)} /></label>}
        <label className="span-4" htmlFor={id('notes')}>Observacions<textarea id={id('notes')} maxLength={500} value={fields.notes} onChange={e => set('notes', e.target.value)} /></label>
        {editing && <label className="span-4" htmlFor={id('motiu')}>Motiu del canvi (queda al registre)<input id={id('motiu')} maxLength={200} placeholder="p. ex. Durada mal introduïda" value={reason} onChange={e => setReason(e.target.value)} /></label>}
      </div>
      {error && <p className="err" role="alert">{error}</p>}
      <div className="view-head">
        <p className="ok" role="status">{ok}</p>
        <div className="actions">
          {editing
            ? <button type="button" onClick={onDone} disabled={busy}>Cancel·la</button>
            : <button type="button" onClick={() => { setFields(empty()); setError(''); setOk(''); }} disabled={busy}>Buida</button>}
          <button className="primary" disabled={busy}>{busy ? 'Desant…' : editing ? 'Desa els canvis' : 'Desa el vol'}</button>
        </div>
      </div>
    </form>
  </section>;
}
