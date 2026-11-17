import { supabase } from './lib/supabase';

export const flightFields = 'id,flight_date,aircraft,duration_minutes,notes,pilot_id';
export type ApprovalStatus = 'pending' | 'approved' | 'blocked';
export type Flight = {
  id: string;
  flight_date: string;
  aircraft: string;
  duration_minutes: number;
  notes: string | null;
  pilot_id: string;
};
export type Profile = { id: string; display_name: string; role: 'pilot' | 'admin'; approval_status: ApprovalStatus };
export type Pilot = {
  id: string;
  display_name: string;
  email: string | null;
  approval_status: ApprovalStatus;
  email_confirmed: boolean;
};

async function readAll<T extends { id: string }>(readPage: (cursor: string | null) => PromiseLike<{
  data: T[] | null;
  error: unknown;
}>): Promise<T[]> {
  const rows: T[] = [];
  let cursor: string | null = null;
  for (;;) {
    const { data, error } = await readPage(cursor);
    if (error || !data) throw error ?? new Error('No hi ha dades.');
    if (data.length === 0) return rows;
    rows.push(...data);
    cursor = data[data.length - 1].id;
  }
}

export async function loadFlights() {
  const flights = await readAll<Flight>(cursor => {
    const query = supabase.from('flights').select(flightFields).order('id').limit(500);
    return cursor ? query.gt('id', cursor) : query;
  });
  return flights.sort((a, b) => b.flight_date.localeCompare(a.flight_date));
}

export async function loadProfile(id: string) {
  const result = await supabase.from('profiles').select('id,display_name,role,approval_status').eq('id', id).single();
  if (!result.error) return { profile: result.data as Profile, approvalsReady: true };
  if (result.error.code !== '42703') throw result.error;

  const legacy = await supabase.from('profiles').select('id,display_name,role').eq('id', id).single();
  if (legacy.error) throw legacy.error;
  return { profile: { ...legacy.data, approval_status: 'approved' } as Profile, approvalsReady: false };
}

export async function loadPilots(approvalsReady: boolean): Promise<Pilot[]> {
  if (!approvalsReady) {
    const profiles = await readAll<Pick<Pilot, 'id' | 'display_name'>>(cursor => {
      const query = supabase.from('profiles').select('id,display_name').eq('role', 'pilot').order('id').limit(500);
      return cursor ? query.gt('id', cursor) : query;
    });
    return profiles.map(profile => ({ ...profile, email: null, approval_status: 'approved', email_confirmed: false }));
  }
  return readAll<Pilot>(cursor => {
    const query = supabase.rpc('list_pilots').order('id').limit(500);
    return cursor ? query.gt('id', cursor) : query;
  });
}

export function summarizeFlights(flights: Flight[], pilotNames: ReadonlyMap<string, string>) {
  const totals = new Map([...pilotNames].map(([id, name]) => [id, { id, name, count: 0, minutes: 0 }]));
  for (const flight of flights) {
    const row = totals.get(flight.pilot_id) ?? { id: flight.pilot_id, name: flight.pilot_id, count: 0, minutes: 0 };
    row.count += 1;
    row.minutes += flight.duration_minutes;
    totals.set(row.id, row);
  }
  return [...totals.values()].sort((a, b) => a.name.localeCompare(b.name, 'ca'));
}

export function formatDuration(minutes: number) {
  return new Intl.NumberFormat('ca').format(Math.floor(minutes / 60)) + ' h ' + String(minutes % 60).padStart(2, '0') + ' min';
}
