import fs from 'node:fs/promises';
import path from 'node:path';

export function normalizeBasePath(value = '') {
  const base = String(value).trim().replace(/\/+$/, '');
  if (!base) return '';
  if (!/^\/(?:[A-Za-z0-9_-]+\/?)+$/.test(base)) {
    throw new Error('BASE_PATH must be an absolute URL prefix such as /luna (letters, numbers, _ and -)');
  }
  return base;
}

export const BASE_PATH = normalizeBasePath(process.env.BASE_PATH);

/** Only URL fields are rewritten: user metadata may itself contain /api/ text. */
export function prefixResponseUrls(value, base = BASE_PATH) {
  if (!base || !value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((item) => prefixResponseUrls(item, base));
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key,
    ['url', 'cover_url', 'stream_url'].includes(key) && typeof item === 'string' && item.startsWith('/api/')
      ? `${base}${item}` : prefixResponseUrls(item, base),
  ]));
}

export function renderHtml(html, base = BASE_PATH) {
  return html.replace(/<head>/i, `<head>\n<base href="${base}/" />`);
}

export async function listDirectories(input) {
  let requested = input;
  if (!requested) {
    requested = process.env.LAM_MEDIA_DIR || '/media';
    try { await fs.access(requested); } catch { requested = process.cwd(); }
  }
  if (!path.isAbsolute(requested)) throw Object.assign(new Error('请输入服务器上的绝对路径'), { status: 400 });
  const current = path.resolve(requested);
  const entries = await fs.readdir(current, { withFileTypes: true });
  const directories = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(current, entry.name);
    if (entry.isDirectory() || (entry.isSymbolicLink() && (await fs.stat(full).catch(() => null))?.isDirectory())) {
      directories.push({ name: entry.name, path: full });
    }
  }
  directories.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN', { numeric: true }));
  return { path: current, parent: path.dirname(current) === current ? null : path.dirname(current), directories };
}
