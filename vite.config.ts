import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';
import { boardLookupApi } from './server/plugin';

export default defineConfig(({ mode }) => {
  // Make ANTHROPIC_API_KEY from .env visible to the server-side lookup code.
  // It is never exposed to the browser bundle (no VITE_ prefix).
  // An empty variable in the shell would otherwise shadow the .env value.
  for (const k of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN']) {
    if (process.env[k] !== undefined && !process.env[k]!.trim()) delete process.env[k];
  }
  const env = loadEnv(mode, process.cwd(), 'ANTHROPIC_');
  for (const [k, v] of Object.entries(env)) if (v.trim()) process.env[k] = v.trim();

  return {
    plugins: [react(), boardLookupApi()],
    base: './',
    worker: { format: 'es' },
  };
});
