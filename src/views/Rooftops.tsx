import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { createRoofMap, type RoofMap } from '../map/roofMap';
import { FlightWeather } from './FlightWeather';
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
const CENTER = { lat: 41.3874, lng: 2.1686 };
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
function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
const fmtKm = (km: number) => km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(km < 10 ? 1 : 0).replace('.', ',')} km`;
type MyPos = { lat: number; lng: number; acc: number };
type Place = { lat: number; lng: number; label: string };

/** Address search with OpenStreetMap (Nominatim), limited to Catalonia. Called only on explicit search, never per keystroke. */
async function searchPlaces(text: string): Promise<Place[]> {
  const url = 'https://nominatim.openstreetmap.org/search?' + new URLSearchParams({
    q: text, format: 'jsonv2', addressdetails: '0', limit: '6', countrycodes: 'es',
    viewbox: '0.15,42.87,3.35,40.5', bounded: '1', 'accept-language': 'ca',
  });
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error('search failed');
  const list = await res.json() as { lat: string; lon: string; display_name: string }[];
  return list.map(x => ({ lat: Number(x.lat), lng: Number(x.lon), label: x.display_name.split(', ').slice(0, 4).join(', ') }));
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
  const [myPos, setMyPos] = useState<MyPos | null>(null);
  const [place, setPlace] = useState<Place | null>(null);
  const [placeQuery, setPlaceQuery] = useState('');
  const [placeResults, setPlaceResults] = useState<Place[] | null>(null);
  const [searchingPlace, setSearchingPlace] = useState(false);
  const [placeError, setPlaceError] = useState('');
  const [locating, setLocating] = useState(false);
  const [geoError, setGeoError] = useState('');
  const watchId = useRef<number | null>(null);
  const centeredOnMe = useRef(false);

  const mapBox = useRef<HTMLDivElement>(null);
  const map = useRef<RoofMap | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [mapWarn, setMapWarn] = useState('');
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

  const origin: { lat: number; lng: number } | null = place ?? myPos;
  const visible = useMemo(() => {
    if (!rows) return [];
    const q = norm(query.trim());
    const list = q ? rows.filter(r => norm([r.name, r.street, r.town, r.contact, r.notes].join(' ')).includes(q)) : rows;
    return origin ? [...list].sort((a, b) => distanceKm(origin, a) - distanceKm(origin, b)) : list;
  }, [rows, query, origin]);
  const selected = rows?.find(r => r.id === selectedId) ?? null;

  // Map setup (once): Google Maps if there is a key, OpenStreetMap otherwise
  useEffect(() => {
    if (!mapBox.current) return;
    let cancelled = false;
    void createRoofMap(mapBox.current, CENTER, setMapWarn).then(m => {
      if (cancelled) { m.destroy(); return; }
      m.onClick(p => {
        if (!editingRef.current) return;
        setDraft(prev => prev && { ...prev, lat: p.lat.toFixed(6), lng: p.lng.toFixed(6) });
      });
      map.current = m;
      setMapReady(true);
    });
    return () => { cancelled = true; map.current?.destroy(); map.current = null; };
  }, []);

  // Markers
  useEffect(() => {
    const m = map.current;
    if (!m || !mapReady) return;
    m.setMarkers(visible.map(r => ({ id: r.id, lat: r.lat, lng: r.lng, title: r.name, selected: r.id === selectedId })), id => setSelectedId(id));
    if (!fitted.current && rows?.length) {
      // Most terrats are in the Barcelona area: frame those, the rest are a pan away.
      const near = rows.filter(r => Math.abs(r.lat - CENTER.lat) < 0.12 && Math.abs(r.lng - CENTER.lng) < 0.16);
      m.fit(near.length ? near : rows);
      fitted.current = true;
    }
  }, [visible, selectedId, rows, mapReady]);

  // Draggable pin while editing
  useEffect(() => {
    const m = map.current;
    if (!m || !mapReady) return;
    const lat = Number(draft?.lat), lng = Number(draft?.lng);
    const ok = editingId && draft && draft.lat !== '' && draft.lng !== '' && Number.isFinite(lat) && Number.isFinite(lng);
    m.setEditPin(ok ? { lat, lng } : null, p => setDraft(prev => prev && { ...prev, lat: p.lat.toFixed(6), lng: p.lng.toFixed(6) }));
  }, [draft?.lat, draft?.lng, editingId, mapReady]);

  // My position on the map
  useEffect(() => {
    const m = map.current;
    if (!m || !mapReady) return;
    m.setMe(myPos);
    if (myPos && !centeredOnMe.current) { m.flyTo(myPos, 15); centeredOnMe.current = true; }
  }, [myPos, mapReady]);
  useEffect(() => () => { if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current); }, []);

  // Searched address on the map
  useEffect(() => {
    const m = map.current;
    if (!m || !mapReady) return;
    m.setPlace(place);
    if (!place) return;
    const nearest = rows ? [...rows].sort((a, b) => distanceKm(place, a) - distanceKm(place, b)).slice(0, 3) : [];
    m.fit([place, ...nearest], 16);
  }, [place, rows, mapReady]);

  function choosePlace(p: Place) { setPlace(p); setPlaceResults(null); setPlaceQuery(p.label); setSelectedId(null); }
  async function findPlace(event: FormEvent) {
    event.preventDefault();
    const text = placeQuery.trim();
    if (text.length < 3) { setPlaceError('Escriu un carrer, una adreça o un lloc.'); return; }
    setPlaceError(''); setSearchingPlace(true); setPlaceResults(null);
    try {
      const found = await searchPlaces(text);
      if (!found.length) setPlaceError('No he trobat aquesta adreça a Catalunya. Prova afegint el número o la població.');
      else if (found.length === 1) choosePlace(found[0]);
      else setPlaceResults(found);
    } catch {
      setPlaceError("No s'ha pogut fer la cerca. Revisa la connexió i torna-ho a provar.");
    } finally { setSearchingPlace(false); }
  }

  function locateMe() {
    setGeoError('');
    if (myPos) { map.current?.flyTo(myPos, 15); return; }
    if (!('geolocation' in navigator)) { setGeoError('Aquest dispositiu no permet obtenir la ubicació.'); return; }
    setLocating(true);
    centeredOnMe.current = false;
    watchId.current = navigator.geolocation.watchPosition(
      p => { setLocating(false); setMyPos({ lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy }); },
      err => {
        setLocating(false);
        setGeoError(err.code === err.PERMISSION_DENIED
          ? "No tens permís de ubicació. Activa'l per a aquesta web a la configuració del navegador o del mòbil i torna-ho a provar."
          : "No s'ha pogut trobar la teva ubicació. Prova-ho a l'exterior o amb el GPS activat.");
        if (watchId.current !== null) { navigator.geolocation.clearWatch(watchId.current); watchId.current = null; }
      },
      { enableHighAccuracy: true, maximumAge: 15_000, timeout: 20_000 },
    );
  }

  function focus(r: Rooftop) {
    setSelectedId(r.id);
    map.current?.flyTo(r, 16);
    mapBox.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  function startEdit(r: Rooftop | null) {
    const c = map.current?.center();
    setEditingId(r ? r.id : 'new');
    setFormError('');
    setNotice('');
    setDraft({
      name: r?.name ?? '', street: r?.street ?? '', town: r?.town ?? '', province: r?.province ?? '', contact: r?.contact ?? '',
      phones: r?.phones ?? '', email: r?.email ?? '', hours: r?.hours ?? '', notes: r?.notes ?? '',
      lat: r ? String(r.lat) : (c ? c.lat.toFixed(6) : String(CENTER.lat)), lng: r ? String(r.lng) : (c ? c.lng.toFixed(6) : String(CENTER.lng)),
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
      <div className="actions">
        <button type="button" className="primary" onClick={locateMe} disabled={locating}>{locating ? 'Buscant…' : myPos ? 'Centra on soc' : 'On soc'}</button>
        {data.isAdmin && !editingId && <button type="button" onClick={() => startEdit(null)}>Afegeix terrat</button>}
      </div>
    </div>
    {geoError && <p className="err" role="alert">{geoError}</p>}
    {mapWarn && <p className="err" role="alert">{mapWarn}</p>}
    <form className="place-search" onSubmit={findPlace} role="search">
      <label htmlFor="t-adreca" className="sr-only">Carrer o adreça</label>
      <input id="t-adreca" type="search" placeholder="Escriu un carrer o adreça per veure els terrats més propers (p. ex. Via Laietana 43, Barcelona)" value={placeQuery} onChange={e => setPlaceQuery(e.target.value)} />
      <button className="primary" disabled={searchingPlace}>{searchingPlace ? 'Cercant…' : 'Terrats més propers'}</button>
      {place && <button type="button" onClick={() => { setPlace(null); setPlaceQuery(''); setPlaceResults(null); }}>Treu l'adreça</button>}
    </form>
    {placeError && <p className="err" role="alert">{placeError}</p>}
    {placeResults && <div className="panel place-results">
      <h3>Quina d'aquestes adreces?</h3>
      <ul>{placeResults.map((p, i) => <li key={i}><button type="button" className="link" onClick={() => choosePlace(p)}>{p.label}</button></li>)}</ul>
    </div>}
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
              {origin && <><dt>Distància</dt><dd>{fmtKm(distanceKm(origin, selected))} en línia recta {place ? "de l'adreça cercada" : 'de tu'}</dd></>}
              {selected.contact && <><dt>Contacte</dt><dd>{selected.contact}</dd></>}
              {selected.phones && <><dt>Telèfons</dt><dd>{phoneLinks(selected.phones)}</dd></>}
              {selected.email && <><dt>Correu</dt><dd className="wrap-any">{emailLinks(selected.email)}</dd></>}
              {selected.hours && <><dt>Horari</dt><dd>{selected.hours}</dd></>}
              {selected.notes && <><dt>Comentaris</dt><dd>{selected.notes}</dd></>}
            </dl>
            <div className="actions">
              <a className="btn nav-google" href={`https://www.google.com/maps/dir/?api=1&destination=${selected.lat},${selected.lng}&travelmode=driving`} target="_blank" rel="noreferrer">Google Maps</a>
              <a className="btn nav-waze" href={`https://waze.com/ul?ll=${selected.lat},${selected.lng}&navigate=yes`} target="_blank" rel="noreferrer">Waze</a>
              {data.isAdmin && <button type="button" className="small" onClick={() => startEdit(selected)}>Edita</button>}
              {data.isAdmin && <button type="button" className="small danger" onClick={() => setDeleting(selected)}>Esborra</button>}
            </div>
          </div>}
          {(() => {
            const at = selected ? { lat: selected.lat, lng: selected.lng, label: selected.name }
              : place ? { lat: place.lat, lng: place.lng, label: place.label.split(', ').slice(0, 2).join(', ') }
              : myPos ? { lat: myPos.lat, lng: myPos.lng, label: 'On ets ara' } : null;
            return at ? <FlightWeather lat={at.lat} lng={at.lng} label={at.label} />
              : <p className="hint">Tria un terrat, cerca una adreça o prem «On soc» per veure el vent i el temps per volar.</p>;
          })()}
          <label htmlFor="t-cerca" className="sr-only">Cerca terrats</label>
          <input id="t-cerca" type="search" placeholder="Cerca per nom, carrer, població o contacte…" value={query} onChange={e => setQuery(e.target.value)} />
          <p className="hint">{rows ? `${visible.length} de ${rows.length} terrats${place ? ` · ordenats per distància a ${place.label.split(', ').slice(0, 2).join(', ')}` : myPos ? ' · ordenats per distància a tu' : ''}` : 'Carregant…'}</p>
          <ul className="roof-list">
            {visible.map(r => <li key={r.id}>
              <button type="button" className={r.id === selectedId ? 'on' : undefined} onClick={() => focus(r)}>
                <b>{r.name}</b>
                <span>{origin && <strong className="roof-dist">{fmtKm(distanceKm(origin, r))}</strong>}{address(r) || 'Sense adreça'}</span>
              </button>
              <div className="roof-go" aria-label={`Navega a ${r.name}`}>
                <a className="nav-google" href={`https://www.google.com/maps/dir/?api=1&destination=${r.lat},${r.lng}&travelmode=driving`} target="_blank" rel="noreferrer" title="Navega amb Google Maps">Maps</a>
                <a className="nav-waze" href={`https://waze.com/ul?ll=${r.lat},${r.lng}&navigate=yes`} target="_blank" rel="noreferrer" title="Navega amb Waze">Waze</a>
              </div>
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
