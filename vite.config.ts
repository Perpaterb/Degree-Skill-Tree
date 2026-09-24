import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Served from GitHub Pages at /Degree-Skill-Tree/.
export default defineConfig({
  root: 'web',
  base: process.env.BASE_PATH ?? '/Degree-Skill-Tree/',
  plugins: [react()],
  // VITE_POLL=1 in the dev container, where file events may not cross the bind mount.
  server: { watch: process.env.VITE_POLL ? { usePolling: true, interval: 300 } : undefined },
  build: { outDir: '../dist', emptyOutDir: true, chunkSizeWarningLimit: 1200 },
});
