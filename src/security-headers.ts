/**
 * Unique absolute origins from `urls`, for the CSP `connect-src` directive. Relative or
 * malformed entries are skipped: relative URLs are already covered by `'self'`.
 */
export function collectConnectSrc(urls: readonly string[]): string[] {
  const origins = new Set<string>();
  for (const url of urls) {
    try {
      const { origin } = new URL(url);
      if (origin !== 'null') origins.add(origin);
    } catch {
      // Relative or malformed — nothing to add.
    }
  }
  return [...origins];
}

/**
 * Headers sent with every docs UI response. The CSP allows only this origin's scripts (docfy-ui
 * ships no inline scripts and its config is a non-executed JSON block). `'unsafe-inline'` styles
 * stay allowed because Radix positions popovers with inline `style` attributes, which can't
 * execute code. `img-src https:` keeps remote images in markdown descriptions working.
 */
export function buildSecurityHeaders(options: {
  contentSecurityPolicy?: string;
  connectSrc: string[];
}): [string, string][] {
  const csp =
    options.contentSecurityPolicy ??
    [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https:",
      "font-src 'self' data:",
      `connect-src ${["'self'", ...options.connectSrc].join(' ')}`,
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'self'",
    ].join('; ');

  return [
    ['Content-Security-Policy', csp],
    ['X-Content-Type-Options', 'nosniff'],
    ['Referrer-Policy', 'no-referrer'],
    ['X-Frame-Options', 'SAMEORIGIN'],
  ];
}
