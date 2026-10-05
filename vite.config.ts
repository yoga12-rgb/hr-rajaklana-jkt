import { defineConfig, loadEnv } from 'vite';
import { sveltekit } from '@sveltejs/kit/vite';
import adapter from '@sveltejs/adapter-static';
import { validatePublicSupabaseConfiguration } from './src/lib/configuration.ts';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'PUBLIC_');
  validatePublicSupabaseConfiguration(env.PUBLIC_SUPABASE_URL, env.PUBLIC_SUPABASE_ANON_KEY);
  return {
    envPrefix: ['VITE_', 'PUBLIC_'],
    plugins: [sveltekit({ adapter: adapter({ fallback: '200.html' }) })]
  };
});
