import { defineConfig } from 'vite';

// Relative base so the same build works on GitHub Pages project sites
// (https://user.github.io/last-train/), Netlify/Vercel roots, and file previews.
export default defineConfig({
  base: './',
  build: {
    target: 'es2020',
    assetsDir: 'assets',
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
  },
  server: {
    host: true,
    port: 5173,
  },
});
