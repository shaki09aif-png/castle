import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// Версия для флешки: всё (код, стили) в одном файле castle.html, открывается
// двойным щелчком без интернета и без веб-сервера. HDRI из файла не грузится
// (браузер запрещает чтение файлов с диска) — освещение строится по
// процедурному небу, сцена выглядит почти так же.
export default defineConfig({
  base: './',
  plugins: [viteSingleFile()],
  publicDir: false,
  build: { outDir: 'dist-single', emptyOutDir: true, chunkSizeWarningLimit: 5000 },
});
