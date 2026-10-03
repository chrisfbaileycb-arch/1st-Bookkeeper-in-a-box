import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
    plugins: [react()],
    base: '/',
    resolve: { alias: { '@appdeploy/client': fileURLToPath(new URL('./runtime/client.ts', import.meta.url)) } },
    server: { proxy: { '/api': 'http://localhost:10000' } },
    build: {
        rollupOptions: {
            maxParallelFileOps: 128,
        },
    },
});
