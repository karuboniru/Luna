/** Resolve an app resource against the server-provided <base> URL.
 *
 * Root-relative paths are interpreted as relative to the app mount point, so
 * `/api/foo` resolves to `/luna/api/foo` when the app is mounted at `/luna/`.
 */
export function appUrl(value, baseURI = document.baseURI) {
  const input = String(value ?? '');
  if (input === '') return '';

  // Keep explicitly addressed resources (and protocol-relative URLs) intact.
  if (/^[a-z][a-z\d+.-]*:/i.test(input) || input.startsWith('//')) return input;

  const base = new URL(baseURI);
  if (!input.startsWith('/')) return new URL(input, base).href;

  const basePath = base.pathname.endsWith('/') ? base.pathname : `${base.pathname}/`;
  const mountRoot = basePath === '/' ? '/' : basePath.slice(0, -1);
  // A mount such as /api or /api/albums can overlap a logical API route.
  // Only the explicit mount + /api/ form is already prefixed in that case.
  if (mountRoot !== '/' && input.startsWith('/api/') && !input.startsWith(`${mountRoot}/api/`)) {
    return new URL(input.slice(1), base).href;
  }
  const alreadyMounted = mountRoot !== '/' &&
    (input === mountRoot || input.startsWith(`${mountRoot}/`) ||
      input.startsWith(`${mountRoot}?`) || input.startsWith(`${mountRoot}#`));

  if (alreadyMounted) return new URL(input, base.origin).href;
  return new URL(input.slice(1), base).href;
}
