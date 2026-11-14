import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// DuckDB-Wasm notes
// -----------------
// * The engine ships as a Web Worker + a ~34 MB .wasm binary. We import both
//   with Vite's `?url` suffix (see src/lib/duckdb.ts) so they are emitted as
//   hashed static assets instead of being bundled/inlined into JS.
// * The package must be excluded from dependency pre-bundling, otherwise esbuild
//   tries to rewrite the worker entry points during `vite dev`.
// * `base: './'` keeps every asset path relative, so the `dist/` folder works on
//   GitHub Pages / any static host without extra configuration.
export default defineConfig({
  base: './',
  plugins: [react()],
  optimizeDeps: {
    exclude: ['@duckdb/duckdb-wasm'],
  },
  server: {
    port: 5173,
    fs: {
      // /sql_queries lives at the repo root and is imported with `?raw`.
      allow: ['.'],
    },
  },
  build: {
    target: 'es2022',
    // The .wasm binaries are copied as-is; never try to inline them.
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks: {
          charts: ['recharts'],
          editor: ['@uiw/react-codemirror', '@codemirror/lang-sql'],
          duckdb: ['@duckdb/duckdb-wasm', 'apache-arrow'],
        },
      },
    },
  },
});
