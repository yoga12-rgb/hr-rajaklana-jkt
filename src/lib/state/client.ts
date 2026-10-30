import { createClient } from '@supabase/supabase-js';
import { validatePublicSupabaseConfiguration } from '../configuration';
import { guardedAuthStorage } from '../auth-session-storage';
const configuration = validatePublicSupabaseConfiguration(import.meta.env.PUBLIC_SUPABASE_URL, import.meta.env.PUBLIC_SUPABASE_ANON_KEY);
export const configured = configuration.mode === 'live';
const sessionKey = configured ? `sb-${new URL(configuration.url).hostname.split('.')[0]}-auth-token` : '';
const authStorage = guardedAuthStorage({
  getItem: key => typeof localStorage === 'undefined' ? null : localStorage.getItem(key),
  setItem: (key, value) => localStorage.setItem(key, value),
  removeItem: key => localStorage.removeItem(key)
}, sessionKey, typeof navigator !== 'undefined' && navigator.locks
  ? (name, operation) => navigator.locks.request(name, { mode: 'exclusive' }, operation)
  : null);
export const supabase = configured ? createClient(configuration.url, configuration.key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: sessionKey, storage: authStorage.storage } }) : null;
