import { URL } from 'url';

const BLOCKED_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '::1',
]);

const BLOCKED_RANGES = [
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^169\.254\./,  // link-local
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,  // shared address space
];

export function isSafeUrl(rawUrl: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return false;
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) return false;

  const host = parsed.hostname.toLowerCase();
  if (BLOCKED_HOSTS.has(host)) return false;
  if (BLOCKED_RANGES.some((re) => re.test(host))) return false;

  return true;
}

export function assertSafeUrl(url: string): void {
  if (!isSafeUrl(url)) {
    throw new Error(`Blocked URL (SSRF protection): ${url}`);
  }
}
