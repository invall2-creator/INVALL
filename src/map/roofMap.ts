/// <reference types="google.maps" />
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

/**
 * The Terrats map behind one small interface, so the view does not care which engine draws it:
 * Google Maps (Normal / Satèl·lit / Híbrid) when VITE_GOOGLE_MAPS_KEY is set, OpenStreetMap otherwise.
 */
export type LatLng = { lat: number; lng: number };
export type RoofMarker = LatLng & { id: string; title: string; selected: boolean };

export interface RoofMap {
  readonly engine: 'google' | 'leaflet';
  setMarkers(list: RoofMarker[], onClick: (id: string) => void): void;
  setMe(pos: (LatLng & { acc: number }) | null): void;
  setPlace(place: (LatLng & { label: string }) | null): void;
  setEditPin(pos: LatLng | null, onMove: (p: LatLng) => void): void;
  onClick(cb: (p: LatLng) => void): void;
  flyTo(p: LatLng, minZoom: number): void;
  fit(points: LatLng[], maxZoom?: number): void;
  center(): LatLng;
  destroy(): void;
}

const GOOGLE_KEY = (import.meta.env.VITE_GOOGLE_MAPS_KEY as string | undefined)?.trim();
const TYPE_KEY = 'udron-tipus-mapa';
const ROOF = { fill: '#e65100', stroke: '#7a2d00', selFill: '#ff8a3d', selStroke: '#ffffff' };

export async function createRoofMap(el: HTMLElement, center: LatLng, onWarn: (msg: string) => void): Promise<RoofMap> {
  if (GOOGLE_KEY) {
    try {
      const g = await loadGoogle(GOOGLE_KEY, () => onWarn("Google Maps ha rebutjat la clau d'accés. Revisa la clau i les seves restriccions a Google Cloud."));
      return new GoogleRoofMap(g, el, center);
    } catch {
      onWarn("No s'ha pogut carregar Google Maps; es mostra el mapa d'OpenStreetMap.");
    }
  }
  return new LeafletRoofMap(el, center);
}

let googlePromise: Promise<typeof google> | null = null;
function loadGoogle(key: string, onAuthFail: () => void): Promise<typeof google> {
  (window as unknown as { gm_authFailure: () => void }).gm_authFailure = onAuthFail;
  if (window.google?.maps) return Promise.resolve(window.google);
  googlePromise ??= new Promise((resolve, reject) => {
    const cb = '__udronGoogleMapsReady';
    (window as unknown as Record<string, () => void>)[cb] = () => resolve(window.google);
    const s = document.createElement('script');
    s.src = `https://maps.googleapis.com/maps/api/js?${new URLSearchParams({ key, v: 'weekly', language: 'ca', region: 'ES', callback: cb })}`;
    s.async = true;
    s.onerror = () => { googlePromise = null; reject(new Error('Google Maps failed to load')); };
    document.head.append(s);
  });
  return googlePromise;
}

class GoogleRoofMap implements RoofMap {
  readonly engine = 'google' as const;
  private map: google.maps.Map;
  private markers: google.maps.Marker[] = [];
  private me: (google.maps.Marker | google.maps.Circle)[] = [];
  private place: google.maps.Marker | null = null;
  private pin: google.maps.Marker | null = null;
  private listeners: google.maps.MapsEventListener[] = [];

  constructor(private g: typeof google, el: HTMLElement, center: LatLng) {
    let saved = 'hybrid';
    try { saved = localStorage.getItem(TYPE_KEY) || saved; } catch { /* ignore */ }
    this.map = new g.maps.Map(el, {
      center, zoom: 12, mapTypeId: saved, tilt: 0, clickableIcons: false,
      streetViewControl: false, fullscreenControl: true, gestureHandling: 'greedy',
      mapTypeControl: true,
      mapTypeControlOptions: {
        mapTypeIds: ['roadmap', 'satellite', 'hybrid'],
        style: g.maps.MapTypeControlStyle.HORIZONTAL_BAR,
        position: g.maps.ControlPosition.TOP_RIGHT,
      },
    });
    this.listeners.push(this.map.addListener('maptypeid_changed', () => {
      try { localStorage.setItem(TYPE_KEY, this.map.getMapTypeId() ?? 'hybrid'); } catch { /* ignore */ }
    }));
  }

  private dot(selected: boolean, scale: number, fill = ROOF.fill, stroke = ROOF.stroke): google.maps.Symbol {
    return {
      path: this.g.maps.SymbolPath.CIRCLE, scale, fillOpacity: 1, strokeWeight: selected ? 3 : 2,
      fillColor: selected ? ROOF.selFill : fill, strokeColor: selected ? ROOF.selStroke : stroke,
    };
  }

  setMarkers(list: RoofMarker[], onClick: (id: string) => void) {
    for (const m of this.markers) m.setMap(null);
    this.markers = list.map(r => {
      const m = new this.g.maps.Marker({
        map: this.map, position: r, title: r.title, zIndex: r.selected ? 1000 : 10,
        icon: this.dot(r.selected, r.selected ? 10 : 7),
      });
      m.addListener('click', () => onClick(r.id));
      return m;
    });
  }

  setMe(pos: (LatLng & { acc: number }) | null) {
    for (const x of this.me) x.setMap(null);
    this.me = [];
    if (!pos) return;
    this.me.push(new this.g.maps.Circle({
      map: this.map, center: pos, radius: pos.acc, clickable: false,
      strokeColor: '#4f93e6', strokeWeight: 1, fillColor: '#4f93e6', fillOpacity: 0.15,
    }));
    this.me.push(new this.g.maps.Marker({
      map: this.map, position: pos, title: 'Ets aquí', zIndex: 2000,
      icon: { path: this.g.maps.SymbolPath.CIRCLE, scale: 8, fillColor: '#1a73e8', fillOpacity: 1, strokeColor: '#ffffff', strokeWeight: 3 },
    }));
  }

  setPlace(place: (LatLng & { label: string }) | null) {
    this.place?.setMap(null);
    this.place = place ? new this.g.maps.Marker({ map: this.map, position: place, title: place.label, zIndex: 1500 }) : null;
  }

  setEditPin(pos: LatLng | null, onMove: (p: LatLng) => void) {
    if (!pos) { this.pin?.setMap(null); this.pin = null; return; }
    if (!this.pin) {
      this.pin = new this.g.maps.Marker({
        map: this.map, position: pos, draggable: true, zIndex: 3000, title: 'Arrossega per situar el terrat',
        icon: { path: this.g.maps.SymbolPath.BACKWARD_CLOSED_ARROW, scale: 7, fillColor: '#e9b13c', fillOpacity: 1, strokeColor: '#ffffff', strokeWeight: 2 },
      });
      this.pin.addListener('dragend', () => {
        const p = this.pin?.getPosition();
        if (p) onMove({ lat: p.lat(), lng: p.lng() });
      });
    } else {
      this.pin.setPosition(pos);
    }
  }

  onClick(cb: (p: LatLng) => void) {
    this.listeners.push(this.map.addListener('click', (e: google.maps.MapMouseEvent) => {
      if (e.latLng) cb({ lat: e.latLng.lat(), lng: e.latLng.lng() });
    }));
  }

  flyTo(p: LatLng, minZoom: number) {
    this.map.panTo(p);
    if ((this.map.getZoom() ?? 0) < minZoom) this.map.setZoom(minZoom);
  }

  fit(points: LatLng[], maxZoom = 18) {
    if (!points.length) return;
    const b = new this.g.maps.LatLngBounds();
    for (const p of points) b.extend(p);
    this.map.fitBounds(b, 40);
    this.g.maps.event.addListenerOnce(this.map, 'idle', () => {
      if ((this.map.getZoom() ?? 0) > maxZoom) this.map.setZoom(maxZoom);
    });
  }

  center(): LatLng {
    const c = this.map.getCenter();
    return c ? { lat: c.lat(), lng: c.lng() } : { lat: 41.3874, lng: 2.1686 };
  }

  destroy() {
    for (const l of this.listeners) l.remove();
    this.setMarkers([], () => {});
    this.setMe(null);
    this.setPlace(null);
    this.pin?.setMap(null);
  }
}

class LeafletRoofMap implements RoofMap {
  readonly engine = 'leaflet' as const;
  private map: L.Map;
  private markers = L.layerGroup();
  private me = L.layerGroup();
  private place = L.layerGroup();
  private pin: L.Marker | null = null;

  constructor(el: HTMLElement, center: LatLng) {
    this.map = L.map(el, { center, zoom: 12 });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(this.map);
    this.markers.addTo(this.map); this.me.addTo(this.map); this.place.addTo(this.map);
    setTimeout(() => this.map.invalidateSize(), 0);
  }

  setMarkers(list: RoofMarker[], onClick: (id: string) => void) {
    this.markers.clearLayers();
    for (const r of list) {
      L.circleMarker([r.lat, r.lng], {
        radius: r.selected ? 10 : 7, weight: 2, color: r.selected ? ROOF.selStroke : ROOF.stroke,
        fillColor: r.selected ? ROOF.selFill : ROOF.fill, fillOpacity: 0.95,
      }).bindTooltip(r.title, { direction: 'top', offset: [0, -6] }).on('click', () => onClick(r.id)).addTo(this.markers);
    }
  }

  setMe(pos: (LatLng & { acc: number }) | null) {
    this.me.clearLayers();
    if (!pos) return;
    L.circle([pos.lat, pos.lng], { radius: pos.acc, color: '#4f93e6', weight: 1, fillColor: '#4f93e6', fillOpacity: 0.12, interactive: false }).addTo(this.me);
    L.circleMarker([pos.lat, pos.lng], { radius: 8, color: '#ffffff', weight: 3, fillColor: '#1a73e8', fillOpacity: 1 })
      .bindTooltip('Ets aquí', { direction: 'top', offset: [0, -6] }).addTo(this.me);
  }

  setPlace(place: (LatLng & { label: string }) | null) {
    this.place.clearLayers();
    if (!place) return;
    L.marker([place.lat, place.lng], { icon: L.divIcon({ className: 'roof-pin place', html: '<span></span>', iconSize: [26, 26], iconAnchor: [13, 26] }) })
      .bindTooltip(place.label, { direction: 'top', offset: [0, -24] }).addTo(this.place);
  }

  setEditPin(pos: LatLng | null, onMove: (p: LatLng) => void) {
    if (!pos) { this.pin?.remove(); this.pin = null; return; }
    if (!this.pin) {
      this.pin = L.marker([pos.lat, pos.lng], {
        draggable: true,
        icon: L.divIcon({ className: 'roof-pin', html: '<span></span>', iconSize: [26, 26], iconAnchor: [13, 26] }),
      }).on('dragend', e => { const p = (e.target as L.Marker).getLatLng(); onMove({ lat: p.lat, lng: p.lng }); }).addTo(this.map);
    } else {
      this.pin.setLatLng([pos.lat, pos.lng]);
    }
  }

  onClick(cb: (p: LatLng) => void) { this.map.on('click', e => cb({ lat: e.latlng.lat, lng: e.latlng.lng })); }
  flyTo(p: LatLng, minZoom: number) { this.map.flyTo([p.lat, p.lng], Math.max(this.map.getZoom(), minZoom), { duration: 0.6 }); }
  fit(points: LatLng[], maxZoom = 18) {
    if (points.length) this.map.flyToBounds(L.latLngBounds(points.map(p => [p.lat, p.lng] as L.LatLngTuple)), { padding: [40, 40], maxZoom, duration: 0.8 });
  }
  center(): LatLng { const c = this.map.getCenter(); return { lat: c.lat, lng: c.lng }; }
  destroy() { this.map.remove(); }
}
