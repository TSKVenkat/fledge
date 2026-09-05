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
 * Relative references to the project's own files are INLINED, not linked.
 *
 * The first version built blob: URLs for them. Those are bound to the origin
 * that created them -- ours -- and the preview runs at an opaque origin, on
 * purpose, so that it cannot reach anything of ours. It therefore could not
 * reach the blobs either, and every relative stylesheet and script silently
 * failed to load. Inlining is the only approach that works regardless of
 * origin, and it means nothing is fetched from anywhere to render the page.
 */
export function buildPreview(files: Record<string, string>, entry: string): {
  html: string;
  revoke: () => void;
} {
  const lookup = (value: string): string | undefined => {
    const path = value.replace(/^\.\//, '').replace(/^\//, '');
    return path === entry ? undefined : files[path];
  };
  // A closing tag inside inlined script or style would end the element early
  // and hand the rest of the file to the parser as HTML.
  const safeScript = (code: string) => code.replace(/<\/(script)/gi, '<\\/$1');
  const safeStyle = (css: string) => css.replace(/<\/(style)/gi, '<\\/$1');

  const source = files[entry] ?? '';
  let html = source
    // <link rel="stylesheet" href="x.css"> -> <style>...</style>
    .replace(/<link\b[^>]*\bhref\s*=\s*(["'])([^"']+)\1[^>]*>/gi, (whole, _q: string, href: string) => {
      if (!/rel\s*=\s*["']?stylesheet/i.test(whole)) return whole;
      if (/^(https?:|data:|blob:|\/\/)/i.test(href)) return whole;
      const css = lookup(href);
      return css === undefined ? whole : `<style data-from="${href}">${safeStyle(css)}</style>`;
    })
    // <script src="x.js"></script> -> <script>...</script>
    .replace(/<script\b([^>]*)\bsrc\s*=\s*(["'])([^"']+)\2([^>]*)>\s*<\/script>/gi,
      (whole, before: string, _q: string, src: string, after: string) => {
        if (/^(https?:|data:|blob:|\/\/)/i.test(src)) return whole;
        const js = lookup(src);
        if (js === undefined) return whole;
        const attrs = (before + after).replace(/\s+/g, ' ').trim();
        return `<script${attrs ? ' ' + attrs : ''} data-from="${src}">${safeScript(js)}</script>`;
      })
    // Anything else relative (img src, etc.) -> a data: URI of the file.
    .replace(/\b(src|href)\s*=\s*(["'])([^"']+)\2/gi, (whole, attribute: string, quote: string, value: string) => {
      if (/^(https?:|data:|blob:|#|\/\/|mailto:)/i.test(value)) return whole;
      const body = lookup(value);
      if (body === undefined) return whole;
      const mime = mimeFor(value);
      return `${attribute}=${quote}data:${mime};base64,${toBase64(body)}${quote}`;
    });

  html = /<html[\s>]/i.test(html)
    ? (/<head[^>]*>/i.test(html)
        ? html.replace(/<head[^>]*>/i, (head) => head + CONSOLE_SHIM)
        : CONSOLE_SHIM + html)
    : `<!doctype html><html><head><meta charset="utf-8">${CONSOLE_SHIM}</head><body>${html}</body></html>`;

  // Nothing to revoke any more; kept so callers need not change.
  return { html, revoke: () => {} };
}

function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** Draw ops are a Python concern; the web preview never produces them. */
export const NO_DRAW: readonly DrawOp[] = [];
