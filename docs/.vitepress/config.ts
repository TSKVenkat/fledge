import { defineConfig } from 'vitepress';

export default defineConfig({
  title: 'fledge',
  description: 'A coding classroom that runs in the browser and on your own server.',
  lang: 'en-GB',
  cleanUrls: true,
  // Local addresses are instructions to the reader, not links to check: they
  // are supposed to be unreachable from wherever the docs are built.
  ignoreDeadLinks: [/^https?:\/\/(localhost|127\.0\.0\.1|sandbox\.localhost)/],
  lastUpdated: true,
  themeConfig: {
    nav: [
      { text: 'Guide', link: '/guide/installation' },
      { text: 'Reference', link: '/reference/architecture' },
    ],
    sidebar: {
      '/guide/': [{
        text: 'Guide',
        items: [
          { text: 'Installation', link: '/guide/installation' },
          { text: 'Configuration', link: '/guide/configuration' },
          { text: 'Embedding', link: '/guide/embedding' },
        ],
      }],
      '/reference/': [{
        text: 'Reference',
        items: [
          { text: 'Architecture', link: '/reference/architecture' },
          { text: 'turtle support', link: '/reference/turtle' },
        ],
      }],
    },
    socialLinks: [{ icon: 'github', link: 'https://github.com/TSKVenkat/fledge' }],
    editLink: {
      pattern: 'https://github.com/TSKVenkat/fledge/edit/main/docs/:path',
      text: 'Edit this page',
    },
    footer: { message: 'Released under the AGPL-3.0 licence.' },
    search: { provider: 'local' },
  },
});
