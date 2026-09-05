/**
 * The HTML/CSS/JS preview.
 *
 * Student JavaScript runs in an iframe with `sandbox="allow-scripts"` and
 * NOTHING else. Without `allow-same-origin` the document has an opaque origin:
 * no cookies, no localStorage, no Cache Storage, and no way to reach the
 * document that framed it. That combination is what makes it safe to run code
 * a child wrote and a classmate may have edited.
 *
 * The page is assembled here rather than served, so a preview costs no request
 * and no storage, and a student's file set never becomes a hosted website.
 */
import type { DrawOp } from '../types.ts';

export interface PreviewMessage {
  t: 'console' | 'error';
  level: 'log' | 'warn' | 'error' | 'info';
  text: string;
}

/**
 * Sent into the preview so `console.log` reaches the same panel as Python's
 * `print`. Written as a string because it must run inside the opaque-origin
 * document, which shares nothing with this module.
 */
const CONSOLE_SHIM = `<script>
(function () {
  var send = function (level, args) {
    try {
      parent.postMessage({ t: 'console', level: level, text: Array.prototype.map.call(args, function (a) {
        if (typeof a === 'string') return a;
        try { return JSON.stringify(a); } catch (e) { return String(a); }
      }).join(' ') }, '*');
    } catch (e) { /* a preview must never break the page it reports to */ }
  };
  ['log', 'warn', 'error', 'info'].forEach(function (level) {
    var original = console[level];
    console[level] = function () { send(level, arguments); original.apply(console, arguments); };
  });
  addEventListener('error', function (event) {
    parent.postMessage({ t: 'error', level: 'error',
      text: event.message + ' (line ' + event.lineno + ')' }, '*');
  });
  addEventListener('unhandledrejection', function (event) {
    parent.postMessage({ t: 'error', level: 'error',
      text: 'Unhandled promise rejection: ' + event.reason }, '*');
  });
})();
</script>`;

const MIME: Record<string, string> = {
  js: 'text/javascript', mjs: 'text/javascript', css: 'text/css',
  json: 'application/json', svg: 'image/svg+xml', html: 'text/html', txt: 'text/plain',
};

const mimeFor = (path: string) => MIME[path.split('.').pop()?.toLowerCase() ?? ''] ?? 'text/plain';

/**
 * Relative references are rewritten to blob URLs built from the project's own
 * files. A student writing `<script src="app.js">` gets what they expect, and
 * nothing is fetched from the network to make it happen.
 */
export function buildPreview(files: Record<string, string>, entry: string): {
  html: string;
  revoke: () => void;
} {
  const urls = new Map<string, string>();
  const created: string[] = [];

  for (const [path, content] of Object.entries(files)) {
    if (path === entry) continue;
    const url = URL.createObjectURL(new Blob([content], { type: mimeFor(path) }));
    urls.set(path, url);
    urls.set(`./${path}`, url);
    urls.set(`/${path}`, url);
    created.push(url);
  }

  const source = files[entry] ?? '';
  const rewritten = source.replace(
    /\b(src|href)\s*=\s*(["'])([^"']+)\2/gi,
    (whole, attribute: string, quote: string, value: string) => {
      // Absolute and protocol-relative references are left alone: a student
      // linking to a real stylesheet should get it.
      if (/^(https?:|data:|blob:|#|\/\/)/i.test(value)) return whole;
      const url = urls.get(value);
      return url ? `${attribute}=${quote}${url}${quote}` : whole;
    },
  );

  const html = /<html[\s>]/i.test(rewritten)
    ? rewritten.replace(/<head[^>]*>/i, (head) => head + CONSOLE_SHIM)
    : `<!doctype html><html><head><meta charset="utf-8">${CONSOLE_SHIM}</head><body>${rewritten}</body></html>`;

  // If there was no <head> to inject into, put the shim first regardless.
  const withShim = html.includes(CONSOLE_SHIM) ? html : CONSOLE_SHIM + html;

  return { html: withShim, revoke: () => { for (const url of created) URL.revokeObjectURL(url); } };
}

/** Draw ops are a Python concern; the web preview never produces them. */
export const NO_DRAW: readonly DrawOp[] = [];
