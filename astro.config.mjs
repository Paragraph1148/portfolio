// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';

export default defineConfig({
  site: 'https://rishabhkushwaha.com',
  integrations: [react()],
  // Static output rsynced to the Oracle box; Caddy serves dist/ directly.
  // resume.pdf deliberately lives OUTSIDE dist so `rsync --delete` can't wipe it.
  build: { assets: 'assets' },
  vite: {
    ssr: { noExternal: ['three'] },
  },
});
