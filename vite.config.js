import { defineConfig } from 'vite';

// Сайт публикуется на GitHub Pages по адресу https://shaki09aif-png.github.io/castle/,
// поэтому при сборке все пути начинаются с /castle/. При разработке (npm run dev) — с /.
// Собранные скрипты кладём в build/, чтобы не смешивать их с public/assets
// (текстуры и HDRI), которые копируются в сборку как есть.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/castle/' : '/',
  build: {
    assetsDir: 'build',
    chunkSizeWarningLimit: 2000,
  },
}));
