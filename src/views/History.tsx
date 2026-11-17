import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type { AppData } from '../context';
import { MISSIONS, loadChanges, type Flight, type FlightChange } from '../flight-data';
import { daysBetween, fmtDate, fmtDateTime, fmtHM, fmtHours, sumMinutes, todayISO } from '../format';
import { supabase } from '../lib/supabase';
import { Modal } from '../Modal';

type Filters = { period: string; from: string; to: string; pilot: string; aircraft: string; mission: string; text: string; deleted: boolean };

const FIELD_LABELS: Record<string, string> = {
  flight_date: 'Data', start_time: 'Enlairament', end_time: 'Aterratge', duration_minutes: 'Durada', aircraft: 'Aeronau',
  place: 'Lloc', mission: 'Servei', category: 'Categoria', light: 'Condicions', crew_role: 'Funció', takeoffs: 'Enlairaments',
  incident: 'Incidència', incident_text: 'Descripció incidència', notes: 'Observacions',
};

function inPeriod(date: string, f: Filters) {
  const today = todayISO();
  switch (f.period) {
    case 'mes': return date.slice(0, 7) === today.slice(0, 7);
    case '3m': return daysBetween(date, today) <= 92;
    case '12m': return daysBetween(date, today) <= 366;
    case 'any': return date.slice(0, 4) === today.slice(0, 4);
    case 'custom': return (!f.from || date >= f.from) && (!f.to || date <= f.to);
    default: return true;
  }
}

function showValue(field: string, value: unknown) {
  if (value === null || value === undefined || value === '') return '—';
  if (field === 'duration_minutes') return fmtHM(Number(value));
  if (field === 'flight_date') return fmtDate(String(value));
  if (field === 'incident') return value ? 'Sí' : 'No';
  if (field === 'light') return value === 'nit' ? 'Nocturn' : 'Diürn';
  if (field === 'start_time' || field === 'end_time') return String(value).slice(0, 5);
  return String(value);
}

function FlightDetail({ data, flight, onClose }: { data: AppData; flight: Flight; onClose: () => void }) {
  const [changes, setChanges] = useState<FlightChange[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    loadChanges(flight.id).then(rows => active && setChanges(rows)).catch(() => active && setFailed(true));
    return () => { active = false; };
  }, [flight.id]);
  const actionLabel = { edit: 'Edició', delete: 'Eliminació', restore: 'Recuperació' };
  return <>
    <h2 id="detall-titol">Vol del {fmtDate(flight.flight_date)}</h2>
    <dl className="kv">
      <dt>Pilot</dt><dd>{data.nameOf(flight.pilot_id)} · {flight.crew_role === 'observador' ? 'Observador' : 'Pilot al comandament'}</dd>
      <dt>Temps de vol</dt><dd className="num">{fmtHM(flight.duration_minutes)}</dd>
      <dt>Aeronau</dt><dd>{data.craftName(flight)}</dd>
      <dt>Lloc</dt><dd>{flight.place || '—'}</dd>
      <dt>Servei</dt><dd>{flight.mission || '—'}</dd>
      <dt>Categoria</dt><dd>{flight.category || '—'}</dd>
      <dt>Condicions</dt><dd>{flight.light === 'nit' ? 'Nocturn' : 'Diürn'} · {flight.takeoffs || 1} enlairament(s)</dd>
      <dt>Incidència</dt><dd>{flight.incident ? flight.incident_text : 'No'}</dd>
      <dt>Observacions</dt><dd>{flight.notes || '—'}</dd>
      <dt>Registrat</dt><dd>{fmtDateTime(flight.created_at)}</dd>
      {flight.deleted_at && <><dt>Eliminat</dt><dd>{fmtDateTime(flight.deleted_at)} · {flight.delete_reason}</dd></>}
    </dl>
    <h3>Registre de canvis</h3>
    {failed ? <p className="err">No s'ha pogut carregar el registre de canvis.</p>
      : !changes ? <p className="hint">Carregant…</p>
      : !changes.length ? <p className="hint">Sense canvis des que es va registrar.</p>
      : <div className="audit">{[...changes].reverse().map(c => <div key={c.id}>
        <div className="hint">{fmtDateTime(c.changed_at)} · {data.nameOf(c.changed_by)} · {actionLabel[c.action]}</div>
        {c.reason && <div>{c.reason}</div>}
        {c.changes.map(d => <div className="hint" key={d.field}>{FIELD_LABELS[d.field] ?? d.field}: {showValue(d.field, d.from)} → {showValue(d.field, d.to)}</div>)}
      </div>)}</div>}
    <div className="foot"><button type="button" onClick={onClose}>Tanca</button></div>
  </>;
}

export function History({ data, onEdit, initialPilot }: { data: AppData; onEdit: (flight: Flight) => void; initialPilot: string }) {
  const [filters, setFilters] = useState<Filters>({ period: initialPilot ? 'tot' : '12m', from: '', to: '', pilot: initialPilot, aircraft: '', mission: '', text: '', deleted: false });
  const [detail, setDetail] = useState<Flight | null>(null);
  const [removing, setRemoving] = useState<Flight | null>(null);
  const [reason, setReason] = useState('');
  const [dialogError, setDialogError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof Filters>(key: K, value: Filters[K]) => setFilters(prev => ({ ...prev, [key]: value }));

  useEffect(() => { if (initialPilot) setFilters(prev => ({ ...prev, pilot: initialPilot, period: 'tot' })); }, [initialPilot]);

  const rows = useMemo(() => {
    const q = filters.text.trim().toLocaleLowerCase('ca');
    return data.flights.filter(f => {
      if (f.deleted_at && !(data.isAdmin && filters.deleted)) return false;
      if (filters.pilot && f.pilot_id !== filters.pilot) return false;
      if (filters.aircraft && data.craftName(f) !== filters.aircraft) return false;
      if (filters.mission && f.mission !== filters.mission) return false;
      if (!inPeriod(f.flight_date, filters)) return false;
      if (q && ![f.place, f.notes, f.incident_text, data.craftName(f), data.nameOf(f.pilot_id)].join(' ').toLocaleLowerCase('ca').includes(q)) return false;
      return true;
    }).sort((a, b) => b.flight_date.localeCompare(a.flight_date) || b.created_at.localeCompare(a.created_at));
  }, [data, filters]);
  const active = rows.filter(f => !f.deleted_at);
  const pilots = useMemo(() => [...new Set(data.flights.map(f => f.pilot_id))].map(id => [id, data.nameOf(id)] as const).sort((a, b) => a[1].localeCompare(b[1], 'ca')), [data]);
  const crafts = useMemo(() => [...new Set([...data.aircraft.map(a => a.model), ...data.flights.map(data.craftName)])], [data]);

  async function confirmRemove(event: FormEvent) {
    event.preventDefault();
    if (!removing) return;
    if (!reason.trim()) { setDialogError('Indica el motiu.'); return; }
    setBusy(true);
    try {
      const { data: ok, error } = await supabase.rpc('remove_flight', { target_id: removing.id, change_reason: reason.trim() });
      if (error) throw error;
      setNotice(ok ? 'Vol eliminat. Es conserva al registre.' : 'Aquest vol ja no està disponible.');
      setRemoving(null);
      data.reload();
    } catch {
      setDialogError("No s'ha pogut eliminar. Torna-ho a provar.");
    } finally { setBusy(false); }
  }

  async function restore(flight: Flight) {
    setBusy(true);
    try {
      const { error } = await supabase.rpc('restore_flight', { target_id: flight.id });
      if (error) throw error;
      setNotice('Vol recuperat.');
      data.reload();
    } catch { setNotice("No s'ha pogut recuperar el vol."); } finally { setBusy(false); }
  }

  async function exportExcel() {
    if (!active.length) { setNotice('No hi ha vols per exportar amb aquests filtres.'); return; }
    setBusy(true);
    setNotice('');
    try {
      const { downloadWorkbook } = await import('../flight-export');
      await downloadWorkbook(active, data);
    } catch { setNotice("No s'ha pogut generar l'Excel."); } finally { setBusy(false); }
  }

  return <section className="view" aria-labelledby="historial-titol">
    <div className="panel">
      <div className="view-head">
        <h2 id="historial-titol">Historial</h2>
        <button type="button" onClick={() => void exportExcel()} disabled={busy}>Descarrega Excel</button>
      </div>
      <div className="filters">
        <label htmlFor="f-periode">Període<select id="f-periode" value={filters.period} onChange={e => set('period', e.target.value)}>
          <option value="mes">Aquest mes</option><option value="3m">Últims 3 mesos</option><option value="12m">Últims 12 mesos</option>
          <option value="any">Aquest any</option><option value="tot">Tot</option><option value="custom">Personalitzat</option>
        </select></label>
        {filters.period === 'custom' && <>
          <label htmlFor="f-des">Des de<input id="f-des" type="date" value={filters.from} onChange={e => set('from', e.target.value)} /></label>
          <label htmlFor="f-fins">Fins a<input id="f-fins" type="date" value={filters.to} onChange={e => set('to', e.target.value)} /></label>
        </>}
        {data.isAdmin && <label htmlFor="f-pilot">Pilot<select id="f-pilot" value={filters.pilot} onChange={e => set('pilot', e.target.value)}>
          <option value="">Tots</option>{pilots.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select></label>}
        <label htmlFor="f-aeronau">Aeronau<select id="f-aeronau" value={filters.aircraft} onChange={e => set('aircraft', e.target.value)}>
          <option value="">Totes</option>{crafts.map(c => <option key={c}>{c}</option>)}
        </select></label>
        <label htmlFor="f-servei">Servei<select id="f-servei" value={filters.mission} onChange={e => set('mission', e.target.value)}>
          <option value="">Tots</option>{MISSIONS.map(m => <option key={m}>{m}</option>)}
        </select></label>
        <label htmlFor="f-text">Cerca<input id="f-text" type="search" placeholder="Lloc, notes…" value={filters.text} onChange={e => set('text', e.target.value)} /></label>
        {data.isAdmin && <label className="check" htmlFor="f-eliminats"><input id="f-eliminats" type="checkbox" checked={filters.deleted} onChange={e => set('deleted', e.target.checked)} /> Mostra eliminats</label>}
      </div>
      <div className="sumline">
        <span><b>{active.length}</b> vols</span><span><b>{fmtHours(sumMinutes(active))}</b></span>
        <span><b>{fmtHours(sumMinutes(active.filter(f => f.light === 'nit')))}</b> nocturnes</span>
        <span><b>{active.filter(f => f.incident).length}</b> amb incidència</span>
      </div>
      {notice && <p className="ok" role="status">{notice}</p>}
      <div className="tablewrap"><table className="cards">
        <thead><tr><th>Data</th>{data.isAdmin && <th>Pilot</th>}<th>Aeronau</th><th>Lloc · servei</th><th>Durada</th><th>Enl.</th><th><span className="sr-only">Accions</span></th></tr></thead>
        <tbody>
          {!rows.length && <tr><td colSpan={7} className="empty">Cap vol amb aquests filtres.</td></tr>}
          {rows.slice(0, 400).map(f => {
            const canChange = !f.deleted_at && (data.isAdmin || f.pilot_id === data.user.id);
            return <tr key={f.id} className={f.deleted_at ? 'deleted' : undefined}>
              <td data-l="Data" className="num">{fmtDate(f.flight_date)}</td>
              {data.isAdmin && <td data-l="Pilot">{data.nameOf(f.pilot_id)}</td>}
              <td data-l="Aeronau">{data.craftName(f)}</td>
              <td data-l="Lloc · servei"><div>{f.place || '—'}</div><div className="hint">{f.mission || 'Sense especificar'}</div>
                <div className="tags">
                  {f.light === 'nit' && <span className="tag night">Nocturn</span>}
                  {f.crew_role === 'observador' && <span className="tag">Observador</span>}
                  {f.incident && <span className="tag inc">Incidència</span>}
                  {f.updated_at && !f.deleted_at && <span className="tag edit">Editat</span>}
                  {f.deleted_at && <span className="tag inc">Eliminat</span>}
                </div></td>
              <td data-l="Durada" className="num">{fmtHM(f.duration_minutes)}</td>
              <td data-l="Enl." className="num">{f.takeoffs || 1}</td>
              <td className="actions">
                <button className="small" onClick={() => setDetail(f)}>Detall</button>
                {canChange && <button className="small" onClick={() => onEdit(f)}>Edita</button>}
                {canChange && <button className="small danger" onClick={() => { setRemoving(f); setReason(''); setDialogError(''); }}>Elimina</button>}
                {f.deleted_at && data.isAdmin && <button className="small" disabled={busy} onClick={() => void restore(f)}>Recupera</button>}
              </td>
            </tr>;
          })}
          {rows.length > 400 && <tr><td colSpan={7} className="hint">Es mostren els 400 més recents. Afina els filtres o descarrega l'Excel per veure'ls tots.</td></tr>}
        </tbody>
      </table></div>
      <p className="hint">L'Excel inclou els vols filtrats, amb fulls de totals per pilot i per aeronau.</p>
    </div>

    <Modal open={!!detail} onClose={() => setDetail(null)} labelledBy="detall-titol">
      {detail && <FlightDetail data={data} flight={detail} onClose={() => setDetail(null)} />}
    </Modal>
    <Modal open={!!removing} onClose={() => setRemoving(null)} labelledBy="elimina-titol">
      {removing && <form onSubmit={confirmRemove} className="dlg-form">
        <h2 id="elimina-titol">Elimina el vol</h2>
        <p className="hint">{fmtDate(removing.flight_date)} · {data.craftName(removing)} · {fmtHM(removing.duration_minutes)}. Deixarà de comptar a les hores, però es conserva al registre i l'administració el pot recuperar.</p>
        <label htmlFor="motiu-eliminar">Motiu<input id="motiu-eliminar" maxLength={200} value={reason} onChange={e => setReason(e.target.value)} placeholder="p. ex. Vol duplicat" /></label>
        {dialogError && <p className="err" role="alert">{dialogError}</p>}
        <div className="foot"><button type="button" onClick={() => setRemoving(null)}>Cancel·la</button><button className="primary" disabled={busy}>Elimina</button></div>
      </form>}
    </Modal>
  </section>;
}
