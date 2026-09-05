/**
 * Where the sandbox lives is an instance decision, not a build-time one: a
 * different port in the Docker stack, a different host name in production. The
 * API says, and the development fallback keeps the two origins apart locally so
 * the boundary is exercised there too.
 */
function developmentSandboxOrigin(): string {
  const { protocol, hostname, port } = location;
  const other = hostname === 'localhost' ? '127.0.0.1' : 'localhost';
  return `${protocol}//${other}${port ? ':' + port : ''}`;
}

export async function loadSandboxOrigin(): Promise<string> {
  try {
    const response = await fetch('/v1/config', { credentials: 'same-origin' });
    if (response.ok) {
      const config = await response.json() as { sandboxUrl?: string };
      if (config.sandboxUrl) return new URL(config.sandboxUrl).origin;
    }
  } catch {
    // No API reachable: the vite dev server on its own.
  }
  return developmentSandboxOrigin();
}
