import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

/**
 * Vite configuration for Gravity web client
 * Purpose: Configure build tooling for React + TypeScript application
 */
export default defineConfig(({ command, mode }) => {
  const environment = loadEnv(mode, import.meta.dirname, '');
  if (command === 'build' && environment.VITE_E2E_AUTH_ENABLED === 'true') {
    throw new Error('Production builds cannot enable VITE_E2E_AUTH_ENABLED.');
  }
  if (command === 'build' && !environment.VITE_CLERK_PUBLISHABLE_KEY?.trim()) {
    throw new Error('VITE_CLERK_PUBLISHABLE_KEY is required for a deployable web build.');
  }

  return {
    plugins: [react()],
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, './src'),
        '@gravity/core': path.resolve(import.meta.dirname, '../core/src'),
      },
    },
    server: {
      port: 5173,
      open: process.env.CI !== 'true' && process.env.GRAVITY_E2E !== '1',
    },
    build: {
      outDir: 'dist',
      sourcemap: false,
      rolldownOptions: {
        output: {
          codeSplitting: {
            groups: [
              {
                name: 'vendor',
                test: /node_modules[\\/]/,
              },
            ],
          },
        },
      },
    },
  };
});
