import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  // Inline every asset so the build is one self-contained page.
  build: { target: 'es2022', assetsInlineLimit: 50 * 1024 * 1024 },
});
