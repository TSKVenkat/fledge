/**
 * The one line a teacher pastes into their own page.
 *
 *   <script src="https://sandbox.example.net/embed.js"
 *           data-fledge="TOKEN" data-height="380"></script>
 *
 * It has no dependencies and is deliberately not part of the web application:
 * it is served to other people's sites, and must never grow a framework by
 * accident. Everything it does is optional — an iframe written by hand works
 * just as well, only without self-sizing.
 */
interface EmbedScript extends HTMLScriptElement {
  dataset: DOMStringMap & { fledge?: string; height?: string };
}

function mount(script: EmbedScript): void {
  const token = script.dataset.fledge;
  if (!token) return;

  const origin = new URL(script.src, location.href).origin;
  const iframe = document.createElement('iframe');
  iframe.src = `${origin}/embed/${encodeURIComponent(token)}`;
  iframe.title = 'Runnable code example';
  iframe.loading = 'lazy';
  iframe.style.cssText =
    `width:100%;height:${Number(script.dataset.height ?? 380)}px;border:1px solid #e3e3de;` +
    'border-radius:8px;display:block;color-scheme:light';
  // The frame runs untrusted code; it needs scripts and its own origin, and
  // nothing else. Notably absent: allow-top-navigation, so an example cannot
  // redirect the page it is embedded in.
  iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-popups');
  script.parentNode?.insertBefore(iframe, script.nextSibling);

  addEventListener('message', (event: MessageEvent<unknown>) => {
    if (event.origin !== origin || event.source !== iframe.contentWindow) return;
    const data = event.data as { t?: string; height?: number };
    if (data?.t !== 'fledge:height' || typeof data.height !== 'number') return;
    // Clamped: a page should not be able to grow without bound because a
    // program printed a great deal of output.
    iframe.style.height = `${Math.min(Math.max(data.height, 200), 1200)}px`;
  });
}

for (const script of document.querySelectorAll<EmbedScript>('script[data-fledge]')) mount(script);
