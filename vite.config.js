import { defineConfig } from 'vite';

// Сайт публикуется на GitHub Pages: https://shaki09aif-png.github.io/castle/
// Пути относительные ('./'), поэтому собранный сайт работает по этому адресу,
// в любой другой папке веб-сервера и через сервисы вроде raw.githack.com.
// Собранные скрипты кладём в build/, чтобы не смешивать их с public/assets
// (текстуры и HDRI), которые копируются в сборку как есть.
export default defineConfig({
  base: './',
  build: {
    assetsDir: 'build',
    chunkSizeWarningLimit: 2000,
  },
});
