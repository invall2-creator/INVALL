import { useState, type FormEvent } from 'react';
import type { AppData } from '../context';
import { AIRCRAFT_CLASSES, type Aircraft } from '../flight-data';
import { fmtDate, fmtHM, sumMinutes, todayISO } from '../format';
import { supabase } from '../lib/supabase';
import { Modal } from '../Modal';

type Draft = { model: string; serial: string; cls: string; status: Aircraft['status']; interval: string; lastReview: string; order: string };
const statusChip = { operativa: <span className="chip ok">Operativa</span>, manteniment: <span className="chip warn">En manteniment</span>, baixa: <span className="chip mute">Baixa</span> };

export function Fleet({ data }: { data: AppData }) {
  const [editing, setEditing] = useState<Aircraft | 'new' | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState<Aircraft | null>(null);
  const [notice, setNotice] = useState('');

  async function confirmDelete() {
    if (!deleting) return;
    const craft = deleting;
    setBusy(true);
    try {
      const { data: gone, error: deleteError } = await supabase.from('aircraft').delete().eq('id', craft.id).select('id');
      if (deleteError || !gone?.length) throw deleteError ?? new Error('not deleted');
      setNotice(`${craft.model} s'ha esborrat de la flota. Els seus vols es conserven amb el nom de l'aeronau.`);
      data.reload();
    } catch {
      setNotice("No s'ha pogut esborrar l'aeronau. Només l'administració pot fer-ho.");
    } finally { setBusy(false); setDeleting(null); }
  }

  function open(craft: Aircraft | 'new') {
    const a = craft === 'new' ? null : craft;
    setEditing(craft);
    setError('');
    setDraft({
      model: a?.model ?? '', serial: a?.serial ?? '', cls: a?.class ?? '', status: a?.status ?? 'operativa',
      interval: a?.review_interval_hours ? String(a.review_interval_hours) : '', lastReview: a?.last_review ?? '',
      order: String(a?.sort_order ?? Math.max(0, ...data.aircraft.map(x => x.sort_order)) + 1),
    });
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!draft || !editing) return;
    if (!draft.model.trim()) { setError('Indica la marca i el model.'); return; }
    const row = {
      model: draft.model.trim(), serial: draft.serial.trim() || null, class: draft.cls || null, status: draft.status,
      review_interval_hours: Number(draft.interval) || null, last_review: draft.lastReview || null, sort_order: Number(draft.order) || 100,
    };
    setBusy(true);
    try {
      const { error: saveError } = editing === 'new'
        ? await supabase.from('aircraft').insert(row)
        : await supabase.from('aircraft').update(row).eq('id', editing.id);
      if (saveError) throw saveError;
      setEditing(null);
      data.reload();
    } catch {
      setError("No s'ha pogut desar. Només l'administració pot modificar la flota.");
    } finally { setBusy(false); }
  }

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft(prev => prev && { ...prev, [key]: value });

  return <section className="view" aria-labelledby="flota-titol">
    <div className="panel">
      <div className="view-head"><h2 id="flota-titol">Flota</h2>{data.isAdmin && <button type="button" onClick={() => open('new')}>Afegeix aeronau</button>}</div>
      {notice && <p className="ok" role="status">{notice}</p>}
      {!data.aircraft.length ? <p className="empty">Encara no hi ha cap aeronau.</p> : <div className="fleet">
        {data.aircraft.map(a => {
          const flights = data.flights.filter(f => f.aircraft_id === a.id && !f.deleted_at);
          const since = a.last_review ? sumMinutes(flights.filter(f => f.flight_date >= a.last_review!)) : null;
          const pct = a.review_interval_hours && since !== null ? Math.min(100, since / (a.review_interval_hours * 60) * 100) : null;
          const tone = pct === null ? '' : pct >= 100 ? 'bad' : pct >= 80 ? 'warn' : '';
          return <div className="craft" key={a.id}>
            <div className="craft-title"><b>{a.model}</b>{statusChip[a.status]}</div>
            <div className="craft-row"><span>Núm. sèrie</span><span>{a.serial || '—'}</span></div>
            <div className="craft-row"><span>Classe</span><span>{a.class || '—'}</span></div>
            <div className="craft-row"><span>Hores · vols</span><span>{fmtHM(sumMinutes(flights))} · {flights.length}</span></div>
            {pct !== null ? <>
              <div className="craft-row"><span>Des de la revisió ({fmtDate(a.last_review)})</span><span>{fmtHM(since!)} / {a.review_interval_hours}:00</span></div>
              <div className={'progress ' + tone} role="img" aria-label={`${Math.round(pct)} % de l'interval de revisió`}><div style={{ width: `${pct}%` }} /></div>
              {pct >= 100 && <p className="err">Revisió vençuda</p>}
            </> : <p className="hint">Sense pla de revisió</p>}
            {data.isAdmin && <div className="actions">
              <button className="small" onClick={() => open(a)}>Edita</button>
              <button className="small danger" onClick={() => { setNotice(''); setDeleting(a); }}>Esborra</button>
            </div>}
          </div>;
        })}
      </div>}
    </div>
    <Modal open={!!deleting} onClose={() => setDeleting(null)} labelledBy="esborra-aeronau-titol">
      {deleting && <div className="dlg-form">
        <h2 id="esborra-aeronau-titol">Esborrar {deleting.model}?</h2>
        <p>Desapareixerà de la flota i ja no es podrà triar en registrar vols. Els {data.flights.filter(f => f.aircraft_id === deleting.id && !f.deleted_at).length} vols que s'hi van fer es conserven amb el nom «{deleting.model}». Si només està fora de servei temporalment, és millor canviar-ne l'estat a «En manteniment» o «Baixa» des d'«Edita».</p>
        <div className="foot">
          <button type="button" onClick={() => setDeleting(null)}>Cancel·la</button>
          <button type="button" className="primary danger-fill" disabled={busy} onClick={() => void confirmDelete()}>Esborra</button>
        </div>
      </div>}
    </Modal>
    <Modal open={!!editing} onClose={() => setEditing(null)} labelledBy="aeronau-titol">
      {draft && <form onSubmit={save} className="dlg-form">
        <h2 id="aeronau-titol">{editing === 'new' ? 'Nova aeronau' : "Edita l'aeronau"}</h2>
        <div className="form two">
          <label className="span-2" htmlFor="a-model">Marca i model<input id="a-model" maxLength={100} value={draft.model} onChange={e => set('model', e.target.value)} /></label>
          <label htmlFor="a-serie">Número de sèrie<input id="a-serie" maxLength={60} value={draft.serial} onChange={e => set('serial', e.target.value)} /></label>
          <label htmlFor="a-classe">Classe<select id="a-classe" value={draft.cls} onChange={e => set('cls', e.target.value)}><option value="">—</option>{AIRCRAFT_CLASSES.map(c => <option key={c}>{c}</option>)}</select></label>
          <label htmlFor="a-estat">Estat<select id="a-estat" value={draft.status} onChange={e => set('status', e.target.value as Draft['status'])}>
            <option value="operativa">Operativa</option><option value="manteniment">En manteniment</option><option value="baixa">Baixa</option>
          </select></label>
          <label htmlFor="a-ordre">Posició a la llista<input id="a-ordre" type="number" min={1} max={999} value={draft.order} onChange={e => set('order', e.target.value)} /></label>
          <label htmlFor="a-interval">Revisió cada (hores)<input id="a-interval" type="number" min={1} max={5000} value={draft.interval} onChange={e => set('interval', e.target.value)} /></label>
          <label htmlFor="a-revisio">Darrera revisió<input id="a-revisio" type="date" max={todayISO()} value={draft.lastReview} onChange={e => set('lastReview', e.target.value)} /></label>
        </div>
        {error && <p className="err" role="alert">{error}</p>}
        <div className="foot"><button type="button" onClick={() => setEditing(null)}>Cancel·la</button><button className="primary" disabled={busy}>Desa</button></div>
      </form>}
    </Modal>
  </section>;
}
