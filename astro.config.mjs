import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  site: 'https://valkyrieremedy.com',
  vite: {
    plugins: [tailwindcss()],
  },
});
