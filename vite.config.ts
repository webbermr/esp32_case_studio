import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';
import { boardLookupApi } from './server/plugin';

export default defineConfig(({ mode }) => {
  // Make ANTHROPIC_API_KEY from .env visible to the server-side lookup code.
  // It is never exposed to the browser bundle (no VITE_ prefix).
  const env = loadEnv(mode, process.cwd(), 'ANTHROPIC_');
  for (const [k, v] of Object.entries(env)) process.env[k] ??= v;

  return {
    plugins: [react(), boardLookupApi()],
    base: './',
  };
});
