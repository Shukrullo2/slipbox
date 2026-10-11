import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const apiPort = process.env.SLIPBOX_PORT ?? '4747';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: { '/api': `http://127.0.0.1:${apiPort}` },
  },
  build: { chunkSizeWarningLimit: 1500 },
});
