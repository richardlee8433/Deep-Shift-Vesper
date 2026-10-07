import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  // Inline every asset so each build is one self-contained page.
  build: {
    target: 'es2022',
    assetsInlineLimit: 50 * 1024 * 1024,
    // The pages share no chunks, so there is nothing to preload.
    modulePreload: false,
    // Two independent pages: the original idle game and the dig prototype.
    rolldownOptions: { input: { main: 'index.html', dig: 'dig.html' } },
  },
});
