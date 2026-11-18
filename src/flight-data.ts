import { supabase } from './lib/supabase';

export type ApprovalStatus = 'pending' | 'approved' | 'blocked' | 'removed' | 'purged';
export type Role = 'pilot' | 'admin';

export type Flight = {
  id: string;
  pilot_id: string;
  flight_date: string;
  start_time: string | null;
  end_time: string | null;
  duration_minutes: number;
  aircraft: string;
  aircraft_id: string | null;
  place: string | null;
  mission: string | null;
  category: string | null;
  light: 'dia' | 'nit';
  crew_role: 'pilot' | 'observador';
  takeoffs: number;
  incident: boolean;
  incident_text: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string | null;
  deleted_at: string | null;
  deleted_by: string | null;
  delete_reason: string | null;
};

export type Aircraft = {
  id: string;
  model: string;
  serial: string | null;
  class: string | null;
  status: 'operativa' | 'manteniment' | 'baixa';
  review_interval_hours: number | null;
  last_review: string | null;
  sort_order: number;
};

export type Profile = { id: string; display_name: string; role: Role; approval_status: ApprovalStatus };
export type Member = Profile & { email: string | null; email_confirmed: boolean };
export type FlightChange = {
  id: number;
  flight_id: string;
  changed_by: string;
  changed_at: string;
  action: 'edit' | 'delete' | 'restore';
  reason: string | null;
  changes: { field: string; from: unknown; to: unknown }[];
};

export const MISSIONS = ['Recerca de persones', 'Seguretat ciutadana', 'Assalts', 'Trànsit', 'Suport a incendis',
  'Reconeixement / inspecció', 'Esdeveniment', 'Formació', 'Prova tècnica'];
export const CATEGORIES = ['Oberta A1', 'Oberta A2', 'Oberta A3', 'Específica (STS)', 'Específica (autorització)', "Exempta / d'estat"];
export const AIRCRAFT_CLASSES = ['C0', 'C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'Sense classe'];

const flightFields = 'id,pilot_id,flight_date,start_time,end_time,duration_minutes,aircraft,aircraft_id,place,mission,category,light,crew_role,takeoffs,incident,incident_text,notes,created_at,updated_at,deleted_at,deleted_by,delete_reason';

async function readAll<T extends { id: string }>(readPage: (cursor: string | null) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const rows: T[] = [];
  let cursor: string | null = null;
  for (;;) {
    const { data, error } = await readPage(cursor);
    if (error || !data) throw error ?? new Error('No hi ha dades.');
    rows.push(...data);
    if (data.length < 500) return rows;
    cursor = data[data.length - 1].id;
  }
}

export async function loadFlights(pilotId?: string): Promise<Flight[]> {
  const rows = await readAll<Flight>(cursor => {
    let query = supabase.from('flights').select(flightFields).order('id').limit(500);
    if (pilotId) query = query.eq('pilot_id', pilotId);
    return cursor ? query.gt('id', cursor) : query;
  });
  return rows.map(row => ({
    ...row,
    start_time: row.start_time?.slice(0, 5) ?? null,
    end_time: row.end_time?.slice(0, 5) ?? null,
  }));
}

export async function loadAircraft(): Promise<Aircraft[]> {
  const { data, error } = await supabase.from('aircraft')
    .select('id,model,serial,class,status,review_interval_hours,last_review,sort_order')
    .order('sort_order').order('model');
  if (error) throw error;
  return data as Aircraft[];
}

export async function loadProfile(id: string): Promise<Profile> {
  const { data, error } = await supabase.from('profiles').select('id,display_name,role,approval_status').eq('id', id).single();
  if (error) throw error;
  return data as Profile;
}

export async function loadTeam(): Promise<Member[]> {
  return readAll<Member>(cursor => {
    const query = supabase.rpc('list_team').order('id').limit(500);
    return cursor ? query.gt('id', cursor) : query;
  });
}

export async function loadChanges(flightId: string): Promise<FlightChange[]> {
  const { data, error } = await supabase.from('flight_changes')
    .select('id,flight_id,changed_by,changed_at,action,reason,changes').eq('flight_id', flightId).order('changed_at');
  if (error) throw error;
  return data as FlightChange[];
}

/** Missing-migration errors from PostgREST: unknown table, column or function. */
export function isMissingMigration(error: unknown) {
  const code = (error as { code?: string } | null)?.code;
  return code === '42P01' || code === '42703' || code === 'PGRST202' || code === 'PGRST205' || code === 'PGRST204';
}

export type AppSession = { id: string; user_id: string; started_at: string; last_seen_at: string };

export async function loadSessions(days = 7): Promise<AppSession[]> {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const { data, error } = await supabase.from('app_sessions')
    .select('id,user_id,started_at,last_seen_at').gte('last_seen_at', since)
    .order('last_seen_at', { ascending: false }).limit(1000);
  if (error) throw error;
  return data as AppSession[];
}
