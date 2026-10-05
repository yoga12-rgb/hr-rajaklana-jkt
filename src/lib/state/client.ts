import { createClient } from '@supabase/supabase-js';
import { validatePublicSupabaseConfiguration } from '../configuration';
const configuration = validatePublicSupabaseConfiguration(import.meta.env.PUBLIC_SUPABASE_URL, import.meta.env.PUBLIC_SUPABASE_ANON_KEY);
export const configured = configuration.mode === 'live';
export const supabase = configured ? createClient(configuration.url, configuration.key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } }) : null;
