import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
if (!url || !key) throw new Error('Configure VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env.local');
// Only a publishable/anon key belongs in browser code. NEVER use a service_role/secret key here.
export const supabase = createClient(url, key);
