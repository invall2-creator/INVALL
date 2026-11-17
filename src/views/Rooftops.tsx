import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { AppData } from '../context';
import { supabase } from '../lib/supabase';
import { Modal } from '../Modal';

export type Rooftop = {
  id: string; name: string; street: string | null; town: string | null; province: string | null;
  contact: string | null; phones: string | null; email: string | null; hours: string | null; notes: string | null;
  lat: number; lng: number;
};
type Draft = Omit<Rooftop, 'id' | 'lat' | 'lng'> & { lat: string; lng: string };

const FIELDS = 'id,name,street,town,province,contact,phones,email,hours,notes,lat,lng';
const CENTER: L.LatLngTuple = [41.3874, 2.1686];
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLocaleLowerCase('ca');

/** Splits "678466346 - GUÀRDIA 669466787" into callable numbers, keeping the text around them. */
function phoneLinks(text: string) {
  const parts = text.split(/(\+?\d[\d ]{7,}\d)/g);
  return parts.map((part, i) => /^\+?\d[\d ]{7,}\d$/.test(part)
    ? <a key={i} href={'tel:' + part.replace(/\s/g, '')}>{part}</a>
    : <span key={i}>{part}</span>);
}
function emailLinks(text: string) {
  return text.split(/([\w.+-]+@[\w-]+(?:\.[\w-]+)+)/g).map((part, i) => /@/.test(part) && /\.\w+$/.test(part)
    ? <a key={i} href={'mailto:' + part}>{part}</a> : <span key={i}>{part}</span>);
}
const address = (r: Rooftop) => [r.street, r.town].filter(Boolean).join(' · ');

export function Rooftops({ data }: { data: AppData }) {
  const [rows, setRows] = useState<Rooftop[] | null>(null);
  const [problem, setProblem] = useState('');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [editingId, setEditingId] = useState<string | 'new' | null>(null);
  const [formError, setFormError] = useState('');
  const [deleting, setDeleting] = useState<Rooftop | null>(null);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);

  const mapBox = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const pin = useRef<L.Marker | null>(null);
  const fitted = useRef(false);
  const editingRef = useRef(false);
  editingRef.current = editingId !== null;

  useEffect(() => {
    let active = true;
    supabase.from('rooftops').select(FIELDS).order('name').then(({ data: list, error }) => {
      if (!active) return;
      if (error) setProblem(error.code === '42P01' || error.code === 'PGRST205' ? 'Falta aplicar la migració dels terrats a Supabase.' : "No s'han pogut carregar els terrats.");
      else setRows(list as Rooftop[]);
    });
    return () => { active = false; };
  }, [tick]);

  const visible = useMemo(() => {
    if (!rows) return [];
    const q = norm(query.trim());
    return q ? rows.filter(r => norm([r.name, r.street, r.town, r.contact, r.notes].join(' ')).includes(q)) : rows;
  }, [rows, query]);
  const selected = rows?.find(r => r.id === selectedId) ?? null;

  // Map setup (once)
  useEffect(() => {
    if (!mapBox.current || map.current) return;
    const m = L.map(mapBox.current, { center: CENTER, zoom: 12, zoomControl: true });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(m);
    layer.current = L.layerGroup().addTo(m);
    m.on('click', e => {
      if (!editingRef.current) return;
      setDraft(prev => prev && { ...prev, lat: e.latlng.lat.toFixed(6), lng: e.latlng.lng.toFixed(6) });
    });
    map.current = m;
    setTimeout(() => m.invalidateSize(), 0);
    return () => { m.remove(); map.current = null; };
  }, []);

  // Markers
  useEffect(() => {
    const m = map.current, group = layer.current;
    if (!m || !group) return;
    group.clearLayers();
    for (const r of visible) {
      const isSel = r.id === selectedId;
      L.circleMarker([r.lat, r.lng], {
        radius: isSel ? 10 : 7, weight: 2, color: isSel ? '#ffffff' : '#7a2d00',
        fillColor: isSel ? '#ff8a3d' : '#e65100', fillOpacity: 0.95,
      }).bindTooltip(r.name, { direction: 'top', offset: [0, -6] })
        .on('click', () => setSelectedId(r.id))
        .addTo(group);
    }
    if (!fitted.current && rows?.length) {
      // Most terrats are in the Barcelona area: frame those, the rest are a pan away.
      const near = rows.filter(r => Math.abs(r.lat - CENTER[0]) < 0.12 && Math.abs(r.lng - CENTER[1]) < 0.16);
      m.fitBounds(L.latLngBounds((near.length ? near : rows).map(r => [r.lat, r.lng] as L.LatLngTuple)), { padding: [24, 24] });
      fitted.current = true;
    }
  }, [visible, selectedId, rows]);

  // Draggable pin while editing
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    pin.current?.remove();
    pin.current = null;
    const lat = Number(draft?.lat), lng = Number(draft?.lng);
    if (editingId && draft && Number.isFinite(lat) && Number.isFinite(lng) && draft.lat !== '' && draft.lng !== '') {
      pin.current = L.marker([lat, lng], {
        draggable: true,
        icon: L.divIcon({ className: 'roof-pin', html: '<span></span>', iconSize: [26, 26], iconAnchor: [13, 26] }),
      }).on('dragend', e => {
        const p = (e.target as L.Marker).getLatLng();
        setDraft(prev => prev && { ...prev, lat: p.lat.toFixed(6), lng: p.lng.toFixed(6) });
      }).addTo(m);
    }
  }, [draft?.lat, draft?.lng, editingId]);

  function focus(r: Rooftop) {
    setSelectedId(r.id);
    map.current?.flyTo([r.lat, r.lng], Math.max(map.current.getZoom(), 16), { duration: 0.6 });
    mapBox.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  function startEdit(r: Rooftop | null) {
    const c = map.current?.getCenter();
    setEditingId(r ? r.id : 'new');
    setFormError('');
    setNotice('');
    setDraft({
      name: r?.name ?? '', street: r?.street ?? '', town: r?.town ?? '', province: r?.province ?? '', contact: r?.contact ?? '',
      phones: r?.phones ?? '', email: r?.email ?? '', hours: r?.hours ?? '', notes: r?.notes ?? '',
      lat: r ? String(r.lat) : (c ? c.lat.toFixed(6) : String(CENTER[0])), lng: r ? String(r.lng) : (c ? c.lng.toFixed(6) : String(CENTER[1])),
    });
  }
  function stopEdit() { setEditingId(null); setDraft(null); }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!draft || !editingId) return;
    const lat = Number(draft.lat), lng = Number(draft.lng);
    if (!draft.name?.trim()) { setFormError('Indica el nom del terrat.'); return; }
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) { setFormError('La ubicació no és vàlida. Clica al mapa per situar el terrat.'); return; }
    const clean = (v: string | null) => (v ?? '').trim() || null;
    const row = {
      name: draft.name.trim(), street: clean(draft.street), town: clean(draft.town), province: clean(draft.province),
      contact: clean(draft.contact), phones: clean(draft.phones), email: clean(draft.email), hours: clean(draft.hours), notes: clean(draft.notes),
      lat, lng, updated_at: new Date().toISOString(),
    };
    setBusy(true);
    try {
      const result = editingId === 'new'
        ? await supabase.from('rooftops').insert(row).select('id').single()
        : await supabase.from('rooftops').update(row).eq('id', editingId).select('id').single();
      if (result.error || !result.data) throw result.error;
      setSelectedId(result.data.id as string);
      setNotice(editingId === 'new' ? 'Terrat afegit.' : 'Canvis desats.');
      stopEdit();
      setTick(t => t + 1);
    } catch {
      setFormError("No s'ha pogut desar. Només l'administració pot modificar els terrats.");
    } finally { setBusy(false); }
  }

  async function confirmDelete() {
    if (!deleting) return;
    setBusy(true);
    try {
      const { data: gone, error } = await supabase.from('rooftops').delete().eq('id', deleting.id).select('id');
      if (error || !gone?.length) throw error ?? new Error('not deleted');
      setNotice(`${deleting.name} s'ha esborrat.`);
      setSelectedId(null);
      setTick(t => t + 1);
    } catch {
      setNotice("No s'ha pogut esborrar el terrat.");
    } finally { setBusy(false); setDeleting(null); }
  }

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft(prev => prev && { ...prev, [key]: value });
  const field = (key: keyof Draft, label: string, wide = false, long = false) => <label className={wide ? 'span-2' : undefined} htmlFor={'t-' + key}>{label}
    {long
      ? <textarea id={'t-' + key} value={(draft?.[key] as string) ?? ''} onChange={e => set(key, e.target.value)} maxLength={1000} />
      : <input id={'t-' + key} value={(draft?.[key] as string) ?? ''} onChange={e => set(key, e.target.value)} maxLength={200} />}
  </label>;

  return <section className="view" aria-labelledby="terrats-titol">
    <div className="view-head">
      <h2 id="terrats-titol">Terrats {rows && <span className="hint">· {rows.length}</span>}</h2>
      {data.isAdmin && !editingId && <button type="button" onClick={() => startEdit(null)}>Afegeix terrat</button>}
    </div>
    {problem && <p className="err">{problem}</p>}
    {notice && <p className="ok" role="status">{notice}</p>}
    <div className="roof-layout">
      <div className="roof-map-wrap">
        <div ref={mapBox} className="roof-map" role="application" aria-label="Mapa de terrats" />
        {editingId && <p className="roof-hint">Clica al mapa o arrossega el marcador per situar el terrat.</p>}
      </div>
      <aside className="roof-side">
        {editingId && draft ? <form className="panel" onSubmit={save}>
          <h3>{editingId === 'new' ? 'Terrat nou' : 'Edita el terrat'}</h3>
          <div className="form two">
            {field('name', 'Nom', true)}
            {field('street', 'Adreça', true)}
            {field('town', 'Població')}
            {field('province', 'Província')}
            {field('contact', 'Persona de contacte', true)}
            {field('phones', 'Telèfons')}
            {field('email', 'Correu electrònic')}
            {field('hours', 'Horari', true)}
            {field('notes', 'Comentaris', true, true)}
            <label htmlFor="t-lat">Latitud<input id="t-lat" inputMode="decimal" value={draft.lat} onChange={e => set('lat', e.target.value)} /></label>
            <label htmlFor="t-lng">Longitud<input id="t-lng" inputMode="decimal" value={draft.lng} onChange={e => set('lng', e.target.value)} /></label>
          </div>
          {formError && <p className="err" role="alert">{formError}</p>}
          <div className="foot">
            <button type="button" onClick={stopEdit} disabled={busy}>Cancel·la</button>
            <button className="primary" disabled={busy}>Desa</button>
          </div>
        </form> : <>
          {selected && <div className="panel roof-card">
            <div className="view-head"><h3 className="roof-title">{selected.name}</h3><button type="button" className="small" onClick={() => setSelectedId(null)} aria-label="Tanca la fitxa">✕</button></div>
            <dl className="kv">
              {address(selected) && <><dt>Adreça</dt><dd>{address(selected)}</dd></>}
              {selected.contact && <><dt>Contacte</dt><dd>{selected.contact}</dd></>}
              {selected.phones && <><dt>Telèfons</dt><dd>{phoneLinks(selected.phones)}</dd></>}
              {selected.email && <><dt>Correu</dt><dd className="wrap-any">{emailLinks(selected.email)}</dd></>}
              {selected.hours && <><dt>Horari</dt><dd>{selected.hours}</dd></>}
              {selected.notes && <><dt>Comentaris</dt><dd>{selected.notes}</dd></>}
            </dl>
            <div className="actions">
              <a className="btn" href={`https://www.google.com/maps/dir/?api=1&destination=${selected.lat},${selected.lng}`} target="_blank" rel="noreferrer">Com arribar</a>
              {data.isAdmin && <button type="button" className="small" onClick={() => startEdit(selected)}>Edita</button>}
              {data.isAdmin && <button type="button" className="small danger" onClick={() => setDeleting(selected)}>Esborra</button>}
            </div>
          </div>}
          <label htmlFor="t-cerca" className="sr-only">Cerca terrats</label>
          <input id="t-cerca" type="search" placeholder="Cerca per nom, carrer, població o contacte…" value={query} onChange={e => setQuery(e.target.value)} />
          <p className="hint">{rows ? `${visible.length} de ${rows.length} terrats` : 'Carregant…'}</p>
          <ul className="roof-list">
            {visible.map(r => <li key={r.id}>
              <button type="button" className={r.id === selectedId ? 'on' : undefined} onClick={() => focus(r)}>
                <b>{r.name}</b>
                <span>{address(r) || 'Sense adreça'}</span>
              </button>
            </li>)}
          </ul>
        </>}
      </aside>
    </div>
    <Modal open={!!deleting} onClose={() => setDeleting(null)} labelledBy="esborra-terrat-titol">
      {deleting && <div className="dlg-form">
        <h2 id="esborra-terrat-titol">Esborrar {deleting.name}?</h2>
        <p>S'esborrarà el terrat i les seves dades de contacte. No es pot desfer.</p>
        <div className="foot">
          <button type="button" onClick={() => setDeleting(null)}>Cancel·la</button>
          <button type="button" className="primary danger-fill" disabled={busy} onClick={() => void confirmDelete()}>Esborra</button>
        </div>
      </div>}
    </Modal>
  </section>;
}
