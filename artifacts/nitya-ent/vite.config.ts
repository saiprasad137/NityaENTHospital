import path from 'path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

const frontendPort = Number(process.env.VITE_PORT) || 3000;
const apiPort = Number(process.env.PORT) || 8080;
const basePath = process.env.BASE_PATH || '/';
const apiTarget = process.env.VITE_API_URL || process.env.API_URL || `http://localhost:${apiPort}`;

export default defineConfig({
  base: basePath,
  plugins: [
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
    },
    dedupe: ['react', 'react-dom'],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, 'dist/public'),
    emptyOutDir: true,
  },
  server: {
    port: frontendPort,
    host: '0.0.0.0',
    fs: {
      strict: true,
    },
    proxy: {
      '/api': {
        target: apiTarget,
        changeOrigin: true,
        secure: false,
      },
    },
  },
  preview: {
    port: frontendPort,
    host: '0.0.0.0',
  },
});
