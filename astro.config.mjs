import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://marcus1337.github.io',
  output: 'static',
  trailingSlash: 'always',
  integrations: [
    mdx(),
    sitemap({
      // These original HTML pages are copied from public without Astro routing.
      customPages: ['https://marcus1337.github.io/', 'https://marcus1337.github.io/about/'],
    }),
  ],
  markdown: {
    syntaxHighlight: 'shiki',
    shikiConfig: {
      themes: { light: 'github-light', dark: 'github-dark' },
      wrap: false,
    },
  },
});
