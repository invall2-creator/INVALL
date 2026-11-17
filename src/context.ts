import type { User } from '@supabase/supabase-js';
import type { Aircraft, Flight, Member, Profile } from './flight-data';

export type AppData = {
  user: User;
  profile: Profile;
  isAdmin: boolean;
  flights: Flight[];
  aircraft: Aircraft[];
  team: Member[];
  nameOf: (id: string) => string;
  craftName: (flight: Flight) => string;
  reload: () => void;
};
