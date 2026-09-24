import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Served from GitHub Pages at /Degree-Skill-Tree/.
export default defineConfig({
  root: 'web',
  base: process.env.BASE_PATH ?? '/Degree-Skill-Tree/',
  plugins: [react()],
  build: { outDir: '../dist', emptyOutDir: true, chunkSizeWarningLimit: 1200 },
});
