/**
 * Pull readable text from http(s) links the student pastes in chat.
 * Kept separate from the LLM so we can SSRF-check hosts before any fetch.
 */
import * as dns from 'dns/promises';
import * as net from 'net';

export const LINK_FETCH_MAX_URLS = 3;
export const LINK_FETCH_TIMEOUT_MS = 8_000;
export const LINK_FETCH_MAX_BYTES = 2_000_000;
export const LINK_FETCH_MAX_CHARS_PER_PAGE = 40_000;
export const LINK_FETCH_MAX_REDIRECTS = 4;

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'metadata.google.internal',
  'metadata',
]);

export type LinkFetchResult =
  | {
      url: string;
      ok: true;
      title?: string;
      text: string;
      contentType: string;
    }
  | {
      url: string;
      ok: false;
      error: string;
    };

/** Grab http(s) links from a student message (trims trailing punctuation). */
export function extractHttpUrls(text: string, max = LINK_FETCH_MAX_URLS): string[] {
  if (!text) return [];
  const found: string[] = [];
  const seen = new Set<string>();
  const re = /https?:\/\/[^\s<>"'`)\]]+/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    let raw = match[0];
    // Trailing sentence junk often sticks to the match.
    raw = raw.replace(/[.,;:!?'"]+$/g, '');
    try {
      const parsed = new URL(raw);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') continue;
      const key = parsed.href;
      if (seen.has(key)) continue;
      seen.add(key);
      found.push(parsed.href);
      if (found.length >= max) break;
    } catch {
      // skip junk
    }
  }
  return found;
}

/** How many unique http(s) links are in the message (no cap). */
export function countHttpUrls(text: string): number {
  return extractHttpUrls(text, Number.MAX_SAFE_INTEGER).length;
}

export type LinkFetchBatch = {
  results: LinkFetchResult[];
  totalUrls: number;
  /** Links beyond LINK_FETCH_MAX_URLS that we did not open. */
  skippedUrls: number;
};

export function isBlockedHostname(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/\.$/, '');
  if (!host) return true;
  if (BLOCKED_HOSTNAMES.has(host)) return true;
  if (host.endsWith('.localhost') || host.endsWith('.local')) return true;
  if (host === '0' || host === '0.0.0.0') return true;
  return false;
}

/** True for loopback / private / link-local / metadata-ish ranges. */
export function isPrivateOrReservedIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const parts = ip.split('.').map((p) => Number(p));
    if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return true;
    const [a, b] = parts;
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
    if (a >= 224) return true; // multicast / reserved
    return false;
  }

  if (net.isIPv6(ip)) {
    const normalized = ip.toLowerCase();
    if (normalized === '::1' || normalized === '::') return true;
    // IPv4-mapped ::ffff:x.x.x.x
    const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateOrReservedIp(mapped[1]);
    // Unique local fc00::/7, link-local fe80::/10
    if (
      normalized.startsWith('fc') ||
      normalized.startsWith('fd') ||
      normalized.startsWith('fe8') ||
      normalized.startsWith('fe9') ||
      normalized.startsWith('fea') ||
      normalized.startsWith('feb')
    ) {
      return true;
    }
    return false;
  }

  // Unknown family — don't fetch.
  return true;
}

/** DNS + hostname checks before we touch the network with that host. */
export async function assertUrlSafeToFetch(rawUrl: string): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error('That link does not look like a valid URL.');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Only http and https links can be opened.');
  }
  if (parsed.username || parsed.password) {
    throw new Error('Links with embedded credentials are not allowed.');
  }
  if (isBlockedHostname(parsed.hostname)) {
    throw new Error('That host is not allowed.');
  }

  // Literal IP in the URL — check it directly.
  if (net.isIP(parsed.hostname)) {
    if (isPrivateOrReservedIp(parsed.hostname)) {
      throw new Error('Private or local network addresses are not allowed.');
    }
    return parsed;
  }

  let addresses: Array<{ address: string; family: number }>;
  try {
    addresses = await dns.lookup(parsed.hostname, { all: true });
  } catch {
    throw new Error('Could not resolve that hostname.');
  }
  if (!addresses.length) {
    throw new Error('Could not resolve that hostname.');
  }
  for (const addr of addresses) {
    if (isPrivateOrReservedIp(addr.address)) {
      throw new Error('That host resolves to a private or local address.');
    }
  }
  return parsed;
}

/** Rough HTML → plain text (no extra deps). Good enough for articles / docs. */
export function htmlToPlainText(html: string): { title?: string; text: string } {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch
    ? decodeHtmlEntities(titleMatch[1].replace(/\s+/g, ' ').trim())
    : undefined;

  let body = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');

  body = body
    .replace(/<\/(p|div|h[1-6]|li|tr|section|article|br|hr)[^>]*>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<[^>]+>/g, ' ');

  const text = decodeHtmlEntities(body)
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return { title, text };
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => {
      const code = Number(n);
      return Number.isFinite(code) ? String.fromCharCode(code) : '';
    });
}

function truncateText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n\n[Truncated — page was longer than ${maxChars} characters.]`;
}

async function readResponseBody(
  response: Response,
  maxBytes: number,
): Promise<Buffer> {
  if (!response.body) {
    const ab = await response.arrayBuffer();
    const buf = Buffer.from(ab);
    if (buf.length > maxBytes) {
      throw new Error('That page is too large to load.');
    }
    return buf;
  }

  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = Buffer.from(value);
    total += chunk.length;
    if (total > maxBytes) {
      try {
        await reader.cancel();
      } catch {
        // ignore
      }
      throw new Error('That page is too large to load.');
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/**
 * Fetch one URL with redirect re-validation (each hop must stay public http/https).
 * `fetchImpl` is injectable so unit tests don't hit the real network.
 */
export async function fetchOneLinkedPage(
  rawUrl: string,
  options?: {
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
  },
): Promise<LinkFetchResult> {
  const fetchImpl = options?.fetchImpl ?? fetch;
  const timeoutMs = options?.timeoutMs ?? LINK_FETCH_TIMEOUT_MS;
  let current = rawUrl;

  try {
    for (let hop = 0; hop <= LINK_FETCH_MAX_REDIRECTS; hop++) {
      const safeUrl = await assertUrlSafeToFetch(current);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let response: Response;
      try {
        response = await fetchImpl(safeUrl.href, {
          method: 'GET',
          redirect: 'manual',
          signal: controller.signal,
          headers: {
            Accept: 'text/html,application/xhtml+xml,text/plain,application/json;q=0.9,*/*;q=0.1',
            'User-Agent': 'SyllentrasAI-LinkFetch/1.0 (course assistant)',
          },
        });
      } finally {
        clearTimeout(timer);
      }

      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location');
        if (!location) {
          return { url: rawUrl, ok: false, error: 'Redirect was missing a Location header.' };
        }
        current = new URL(location, safeUrl).href;
        continue;
      }

      if (!response.ok) {
        return {
          url: rawUrl,
          ok: false,
          error: `Could not open that page (HTTP ${response.status}).`,
        };
      }

      const contentType = (response.headers.get('content-type') || '').toLowerCase();
      const buf = await readResponseBody(response, LINK_FETCH_MAX_BYTES);
      const rawText = buf.toString('utf8');

      if (
        contentType.includes('text/html') ||
        contentType.includes('application/xhtml') ||
        (!contentType && /^\s*</.test(rawText))
      ) {
        const { title, text } = htmlToPlainText(rawText);
        if (!text.trim()) {
          return { url: rawUrl, ok: false, error: 'That page had no readable text.' };
        }
        return {
          url: rawUrl,
          ok: true,
          title,
          text: truncateText(text, LINK_FETCH_MAX_CHARS_PER_PAGE),
          contentType: contentType || 'text/html',
        };
      }

      if (
        contentType.includes('text/plain') ||
        contentType.includes('application/json') ||
        contentType.includes('text/')
      ) {
        const text = rawText.trim();
        if (!text) {
          return { url: rawUrl, ok: false, error: 'That page had no readable text.' };
        }
        return {
          url: rawUrl,
          ok: true,
          text: truncateText(text, LINK_FETCH_MAX_CHARS_PER_PAGE),
          contentType: contentType || 'text/plain',
        };
      }

      return {
        url: rawUrl,
        ok: false,
        error: 'That link is not a readable web page (need HTML or plain text).',
      };
    }

    return { url: rawUrl, ok: false, error: 'Too many redirects.' };
  } catch (err) {
    const name = err instanceof Error ? err.name : '';
    if (name === 'AbortError') {
      return { url: rawUrl, ok: false, error: 'Timed out while opening that link.' };
    }
    const message =
      err instanceof Error && err.message
        ? err.message
        : 'Could not open that link.';
    return { url: rawUrl, ok: false, error: message };
  }
}

export async function fetchLinkedPagesFromMessage(
  message: string,
  options?: {
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
  },
): Promise<LinkFetchBatch> {
  const totalUrls = countHttpUrls(message);
  const urls = extractHttpUrls(message);
  if (!urls.length) {
    return { results: [], totalUrls: 0, skippedUrls: 0 };
  }

  const results: LinkFetchResult[] = [];
  for (const url of urls) {
    results.push(await fetchOneLinkedPage(url, options));
  }
  return {
    results,
    totalUrls,
    skippedUrls: Math.max(0, totalUrls - urls.length),
  };
}

/** Block appended to the LLM user turn (not stored in chat history). */
export function buildLinkFetchPromptBlock(batch: LinkFetchBatch): string {
  if (!batch.results.length && !batch.skippedUrls) return '';

  const parts: string[] = [
    'Linked page content (fetched because the student shared URL(s); use when helpful):',
  ];

  if (batch.skippedUrls > 0) {
    parts.push(
      `Limit note: The student shared ${batch.totalUrls} links, but only the first ${LINK_FETCH_MAX_URLS} were fetched (${batch.skippedUrls} not opened). You MUST briefly tell them about this ${LINK_FETCH_MAX_URLS}-link-per-message limit and invite them to send the remaining link(s) in a follow-up message.`,
    );
  }

  for (const result of batch.results) {
    if (result.ok) {
      const heading = result.title
        ? `--- Linked page: ${result.title} (${result.url}) ---`
        : `--- Linked page: ${result.url} ---`;
      parts.push(heading, result.text, '---');
    } else {
      parts.push(`--- Linked page failed: ${result.url} ---`, result.error, '---');
    }
  }

  return parts.join('\n');
}

export function linkFetchWarningMessages(batch: LinkFetchBatch): string[] {
  const warnings = batch.results
    .filter((r): r is Extract<LinkFetchResult, { ok: false }> => !r.ok)
    .map((r) => `Could not open link: ${r.error}`);

  if (batch.skippedUrls > 0) {
    warnings.push(
      `I can open up to ${LINK_FETCH_MAX_URLS} links per message — opened the first ${LINK_FETCH_MAX_URLS} of ${batch.totalUrls}. Send the rest in a follow-up if you want those too.`,
    );
  }
  return warnings;
}
