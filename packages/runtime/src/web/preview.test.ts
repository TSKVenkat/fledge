import { describe, it, expect } from 'vitest';
import { buildPreview } from './preview.ts';

const files = {
  'index.html': '<link rel="stylesheet" href="style.css">\n<h1>Hi</h1>\n<img src="pic.svg">\n<script src="app.js"></script>',
  'style.css': 'h1 { color: red }',
  'app.js': 'console.log("ran"); const s = "</script>";',
  'pic.svg': '<svg xmlns="http://www.w3.org/2000/svg"/>',
};

describe('web preview assembly', () => {
  it('inlines a relative stylesheet rather than linking it', () => {
    // Links to blob: URLs failed silently: the preview runs at an opaque
    // origin, and blob URLs are bound to the origin that made them.
    const { html } = buildPreview(files, 'index.html');
    expect(html).toContain('<style data-from="style.css">h1 { color: red }</style>');
    expect(html).not.toContain('href="style.css"');
    expect(html).not.toContain('blob:');
  });

  it('inlines a relative script', () => {
    const { html } = buildPreview(files, 'index.html');
    expect(html).toContain('<script data-from="app.js">console.log("ran");');
    expect(html).not.toContain('src="app.js"');
  });

  it('escapes a closing tag inside inlined code, or the parser would end the element early', () => {
    const { html } = buildPreview(files, 'index.html');
    expect(html).toContain('const s = "<\\/script>"');
  });

  it('turns other relative references into data URIs', () => {
    const { html } = buildPreview(files, 'index.html');
    expect(html).toMatch(/<img src="data:image\/svg\+xml;base64,[A-Za-z0-9+/=]+">/);
  });

  it('leaves absolute and protocol-relative references alone', () => {
    const { html } = buildPreview({ 'index.html': '<link rel="stylesheet" href="https://example.org/x.css"><script src="//cdn.example/y.js"></script>' }, 'index.html');
    expect(html).toContain('href="https://example.org/x.css"');
    expect(html).toContain('src="//cdn.example/y.js"');
  });

  it('leaves a reference to a file the project does not have alone', () => {
    const { html } = buildPreview({ 'index.html': '<script src="missing.js"></script>' }, 'index.html');
    expect(html).toContain('src="missing.js"');
  });

  it('always carries the console shim, with or without a head', () => {
    expect(buildPreview({ 'index.html': '<p>x</p>' }, 'index.html').html).toContain("parent.postMessage({ t: 'console'");
    expect(buildPreview({ 'index.html': '<html><head></head><body></body></html>' }, 'index.html').html).toContain("parent.postMessage({ t: 'console'");
  });
});
