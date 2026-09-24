import { defineConfig } from 'vite';

// base './' — собранную версию (dist/) можно открыть из любой папки веб-сервера
export default defineConfig({
  base: './',
  build: { chunkSizeWarningLimit: 2000 },
});
