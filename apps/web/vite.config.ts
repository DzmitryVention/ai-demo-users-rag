import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // The API serves /api on :8080 locally; in production both share one origin.
    proxy: { '/api': 'http://localhost:8080' },
  },
  build: {
    sourcemap: true,
    target: 'es2023',
    rolldownOptions: {
      output: {
        // Long-term-cacheable vendor chunks that change rarely.
        codeSplitting: {
          groups: [
            { name: 'firebase', test: /node_modules[\\/]@?firebase/ },
            {
              name: 'react',
              test: /node_modules[\\/](react|react-dom|react-router|scheduler)[\\/]/,
            },
            { name: 'vendor', test: /node_modules/ },
          ],
        },
      },
    },
  },
  test: {
    name: 'web',
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
  },
});
