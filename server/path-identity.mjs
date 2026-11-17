/** Filesystem identities follow the host platform; POSIX names are case sensitive. */
export function pathIdentity(value, { platform = process.platform } = {}) {
  const text = String(value);
  return platform === 'win32' ? text.toLowerCase() : text;
}

/** SQL collation for path comparisons (never for display names or metadata). */
export const PATH_COLLATION = process.platform === 'win32' ? 'NOCASE' : 'BINARY';
