import { defineConfig, loadEnv } from 'vite';
import { sveltekit } from '@sveltejs/kit/vite';
import adapter from '@sveltejs/adapter-static';
import { validateDeploymentConfiguration } from './src/lib/configuration.ts';

export default defineConfig(({ mode, command }) => {
  const env = loadEnv(mode, process.cwd(), 'PUBLIC_');
  const { environment } = validateDeploymentConfiguration(env, {
    hosted: command === 'build' && process.env.VERCEL === '1',
    environment: process.env.VERCEL_ENV
  });
  return {
    envPrefix: ['VITE_', 'PUBLIC_'],
    define: { 'import.meta.env.PUBLIC_APP_ENV': JSON.stringify(environment) },
    plugins: [sveltekit({ adapter: adapter({ fallback: '200.html' }) })]
  };
});
