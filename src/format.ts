import type { Flight } from './flight-data';

export const todayISO = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Madrid' });
export const fmtDate = (iso: string | null | undefined) => iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '—';
export const fmtDateTime = (iso: string) => new Date(iso).toLocaleString('ca', { dateStyle: 'short', timeStyle: 'short' });
export const fmtHM = (minutes: number) => `${Math.floor(minutes / 60)}:${String(Math.round(minutes % 60)).padStart(2, '0')}`;
export function fmtHours(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = String(Math.round(minutes % 60)).padStart(2, '0');
  return h ? `${h.toLocaleString('ca')} h ${m} min` : `${Number(m)} min`;
}
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
export const sumMinutes = (flights: Flight[]) => flights.reduce((total, f) => total + f.duration_minutes, 0);
export const lastDate = (flights: Flight[]) => flights.reduce((max, f) => f.flight_date > max ? f.flight_date : max, '');
export const initials = (name: string) => name.trim().split(/\s+/).slice(0, 2).map(part => part[0] || '').join('').toLocaleUpperCase('ca');

/** Accepts "h:mm" or plain minutes. Returns null when empty, NaN when invalid. */
export function parseDuration(value: string): number | null {
  const text = value.trim();
  if (!text) return null;
  const hm = text.match(/^(\d{1,2}):([0-5]\d)$/);
  if (hm) return Number(hm[1]) * 60 + Number(hm[2]);
  if (/^\d{1,4}$/.test(text)) return Number(text);
  return Number.NaN;
}

export function minutesBetween(start: string, end: string) {
  if (!start || !end) return null;
  const [h1, m1] = start.split(':').map(Number);
  const [h2, m2] = end.split(':').map(Number);
  let diff = h2 * 60 + m2 - (h1 * 60 + m1);
  if (diff <= 0) diff += 1440;
  return diff;
}

export type Recency = { tone: 'ok' | 'warn' | 'bad' | 'mute'; label: string };
export function recency(last: string): Recency {
  if (!last) return { tone: 'mute', label: 'Sense vols' };
  const days = daysBetween(last, todayISO());
  if (days <= 30) return { tone: 'ok', label: `Al dia · fa ${days} d` };
  if (days <= 90) return { tone: 'warn', label: `Fa ${days} dies` };
  return { tone: 'bad', label: `${days} dies sense volar` };
}
