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
export const LINK_FETCH_MAX_OUTBOUND = 40;
export const LINK_FETCH_TEASER_MAX_CHARS = 120;
export const SUGGESTED_LINKS_MAX = 3;
/** Enough outbound story links to treat the page as a homepage/listing. */
export const LINK_FETCH_LISTING_MIN_OUTBOUND = 6;

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'metadata.google.internal',
  'metadata',
]);

/** Chrome / share / auth paths we skip when listing outbound article-ish links. */
const OUTBOUND_SKIP_PATH_RE =
  /\/(login|signin|signup|register|cart|checkout|account|auth|oauth|share|twitter|facebook|linkedin|whatsapp|pinterest|mailto)(\/|$)/i;

export type OutboundLink = {
  title: string;
  url: string;
  teaser?: string;
};

export type SuggestedLink = {
  title: string;
  url: string;
  teaser?: string;
};

export type LinkFetchResult =
  | {
      url: string;
      ok: true;
      title?: string;
      text: string;
      contentType: string;
      outboundLinks?: OutboundLink[];
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

function stripNonContentHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function truncateTeaser(text: string, maxChars = LINK_FETCH_TEASER_MAX_CHARS): string {
  const cleaned = collapseWhitespace(text);
  if (!cleaned) return '';
  if (cleaned.length <= maxChars) return cleaned;
  const slice = cleaned.slice(0, maxChars);
  const lastSpace = slice.lastIndexOf(' ');
  return `${(lastSpace > 40 ? slice.slice(0, lastSpace) : slice).trim()}…`;
}

function stripTagsToText(html: string): string {
  return collapseWhitespace(
    decodeHtmlEntities(
      html
        .replace(/<\/(p|div|h[1-6]|li|tr|section|article|br|hr)[^>]*>/gi, ' ')
        .replace(/<br\s*\/?>/gi, ' ')
        .replace(/<[^>]+>/g, ' '),
    ),
  );
}

function isSkippableOutboundHref(href: string): boolean {
  const lower = href.trim().toLowerCase();
  if (!lower || lower.startsWith('#') || lower.startsWith('javascript:')) return true;
  if (lower.startsWith('mailto:') || lower.startsWith('tel:')) return true;
  if (lower.startsWith('data:')) return true;
  return false;
}

function looksLikeChromeOutboundPath(pathname: string): boolean {
  return OUTBOUND_SKIP_PATH_RE.test(pathname);
}

/** Drop date-only / UI crumbs so we keep real blurbs. */
function scrubTeaserCandidate(raw: string, title: string): string {
  let teaser = truncateTeaser(raw);
  if (teaser && teaser.toLowerCase().startsWith(title.toLowerCase())) {
    teaser = truncateTeaser(teaser.slice(title.length));
  }
  // Strip leading date/meta crumbs common on news homepages.
  teaser = teaser
    .replace(
      /^(?:)?\s*(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2},?\s+\d{4}\s*/i,
      '',
    )
    .replace(/^\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{4}\s*/i, '')
    .replace(/^(?:read\s*[➝→>]+|permalink|share|comments?)\s*/i, '')
    .trim();
  if (teaser.length < 12) return '';
  return truncateTeaser(teaser);
}

/**
 * Prefer longer title / any teaser when the same URL appears twice
 * (e.g. image link then headline link on news homepages).
 */
function mergeOutboundCandidate(
  list: OutboundLink[],
  item: OutboundLink,
): void {
  const idx = list.findIndex((existing) => existing.url === item.url);
  if (idx < 0) {
    list.push(item);
    return;
  }
  const prev = list[idx];
  list[idx] = {
    url: item.url,
    title: item.title.length > prev.title.length ? item.title : prev.title,
    teaser: item.teaser || prev.teaser,
  };
}

/** Prefer a clean headline from inside a card-style <a>, not the whole card text. */
function titleFromAnchorInner(inner: string): string {
  const homeTitle = inner.match(
    /<(?:h[1-6]|div|span)[^>]*class=["'][^"']*home-title[^"']*["'][^>]*>([\s\S]*?)<\/(?:h[1-6]|div|span)>/i,
  );
  if (homeTitle) {
    const t = stripTagsToText(homeTitle[1]);
    if (t.length >= 3) return t;
  }
  const heading = inner.match(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/i);
  if (heading) {
    const t = stripTagsToText(heading[1]);
    if (t.length >= 3) return t;
  }
  const alt = inner.match(/<img[^>]*\balt=["']([^"']+)["']/i);
  if (alt?.[1]) {
    const t = decodeHtmlEntities(alt[1]).replace(/\s+/g, ' ').trim();
    if (t.length >= 3) return t;
  }
  return stripTagsToText(inner);
}

/** Blurb inside the same card <a> (e.g. THN .home-desc). */
function teaserFromAnchorInner(inner: string, title: string): string {
  const classDescMatch = inner.match(
    /<(?:div|p|span)[^>]*class=["'][^"']*(?:home-desc|post-desc|summary|excerpt|description|dek|standfirst)[^"']*["'][^>]*>([\s\S]*?)<\/(?:div|p|span)>/i,
  );
  if (classDescMatch) {
    return scrubTeaserCandidate(stripTagsToText(classDescMatch[1]), title);
  }
  return '';
}

/**
 * Pull title + absolute URL + nearby teaser from <a> tags before plain-text stripping.
 * Prefers same-host links; caps at LINK_FETCH_MAX_OUTBOUND.
 */
export function extractOutboundLinks(
  html: string,
  pageUrl: string,
  max = LINK_FETCH_MAX_OUTBOUND,
): OutboundLink[] {
  let page: URL;
  try {
    page = new URL(pageUrl);
  } catch {
    return [];
  }

  const cleaned = stripNonContentHtml(html);
  const anchorRe = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  const sameHost: OutboundLink[] = [];
  const otherHost: OutboundLink[] = [];
  const seenOrder: string[] = [];

  let match: RegExpExecArray | null;
  while ((match = anchorRe.exec(cleaned)) !== null) {
    const attrs = match[1] ?? '';
    const inner = match[2] ?? '';
    const hrefMatch = attrs.match(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    if (!hrefMatch) continue;
    const rawHref = (hrefMatch[1] ?? hrefMatch[2] ?? hrefMatch[3] ?? '').trim();
    if (isSkippableOutboundHref(rawHref)) continue;

    let absolute: URL;
    try {
      absolute = new URL(rawHref, page);
    } catch {
      continue;
    }
    if (absolute.protocol !== 'http:' && absolute.protocol !== 'https:') continue;
    if (looksLikeChromeOutboundPath(absolute.pathname)) continue;

    // Same document (ignore hash-only / identical page).
    const withoutHash = absolute.href.replace(/#.*$/, '');
    const pageWithoutHash = page.href.replace(/#.*$/, '');
    if (withoutHash === pageWithoutHash) continue;

    const title = titleFromAnchorInner(inner);
    if (!title || title.length < 3) continue;
    // Skip chrome-y short labels inside large pages.
    if (/^(read|more|here|link|click|share|tweet)$/i.test(title)) continue;

    // Prefer blurb inside the same card <a> (THN story-link wraps title+desc).
    // Fall back to text after the anchor for sites that put the excerpt outside.
    const afterStart = match.index + match[0].length;
    const afterChunk = cleaned.slice(afterStart, afterStart + 600);
    const beforeNextAnchor = afterChunk.split(/<a\b/i)[0] ?? '';
    const classDescAfter = afterChunk.match(
      /<(?:div|p|span)[^>]*class=["'][^"']*(?:home-desc|post-desc|summary|excerpt|description|dek|standfirst)[^"']*["'][^>]*>([\s\S]*?)<\/(?:div|p|span)>/i,
    );
    const fromInside = teaserFromAnchorInner(inner, title);
    const fromClassAfter = classDescAfter
      ? scrubTeaserCandidate(stripTagsToText(classDescAfter[1]), title)
      : '';
    const fromAfter = scrubTeaserCandidate(stripTagsToText(beforeNextAnchor), title);
    const teaser = fromInside || fromClassAfter || fromAfter;

    const item: OutboundLink = teaser
      ? { title, url: absolute.href, teaser }
      : { title, url: absolute.href };

    const bucket =
      absolute.hostname.toLowerCase() === page.hostname.toLowerCase()
        ? sameHost
        : otherHost;
    const already = seenOrder.includes(absolute.href);
    mergeOutboundCandidate(bucket, item);
    if (!already) {
      seenOrder.push(absolute.href);
    }
    if (seenOrder.length >= max * 2) break;
  }

  return [...sameHost, ...otherHost].slice(0, max);
}

/** Rough HTML → plain text (no extra deps). Good enough for articles / docs. */
export function htmlToPlainText(html: string): { title?: string; text: string } {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch
    ? decodeHtmlEntities(titleMatch[1].replace(/\s+/g, ' ').trim())
    : undefined;

  let body = stripNonContentHtml(html);

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
        const outboundLinks = extractOutboundLinks(rawText, safeUrl.href);
        return {
          url: rawUrl,
          ok: true,
          title,
          text: truncateText(text, LINK_FETCH_MAX_CHARS_PER_PAGE),
          contentType: contentType || 'text/html',
          outboundLinks: outboundLinks.length ? outboundLinks : undefined,
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
      parts.push(heading);

      const listing = looksLikeListingPage(result);
      if (listing) {
        parts.push(
          'Listing/homepage note: This page looks like a news or link listing. Full page body is omitted to keep the prompt focused. Recommend from the outbound headlines below (titles, URLs, teasers).',
        );
      } else {
        parts.push(result.text);
      }

      if (result.outboundLinks?.length) {
        parts.push(
          listing
            ? 'Outbound links on page (recommend up to 3 most relevant to the course; use only these URLs):'
            : 'Outbound links on page (use only these URLs when recommending related articles):',
        );
        for (const link of result.outboundLinks) {
          const teaserBit = link.teaser ? ` — ${link.teaser}` : '';
          parts.push(`- ${link.title} — ${link.url}${teaserBit}`);
        }
      } else if (listing) {
        parts.push(
          '(No outbound article links were extracted; ask the student to paste a specific article URL.)',
        );
      }
      parts.push('---');
    } else {
      parts.push(`--- Linked page failed: ${result.url} ---`, result.error, '---');
    }
  }

  return parts.join('\n');
}

/**
 * Homepages / index pages: shallow path + many outbound story links.
 * Article pages often have related-link sidebars — do NOT treat those as listings
 * or we omit the article body the student asked us to read.
 */
export function looksLikeListingPage(
  result: Extract<LinkFetchResult, { ok: true }>,
): boolean {
  const outbound = result.outboundLinks?.length ?? 0;
  let path = '/';
  try {
    path = new URL(result.url).pathname.replace(/\/+$/, '') || '/';
  } catch {
    // keep default
  }

  const looksLikeArticle =
    /\/\d{4}\/\d{1,2}\//.test(path) ||
    (/\.html?$/i.test(path) && path.split('/').filter(Boolean).length >= 2);

  if (looksLikeArticle) return false;

  const isRootOrIndex =
    path === '/' ||
    path === '' ||
    /\/(index|home|news|blog|latest|articles?)\/?$/i.test(path);

  if (isRootOrIndex && outbound >= 3) return true;

  // Generic listing: many outbound links and a short page body (not a long article).
  if (outbound >= LINK_FETCH_LISTING_MIN_OUTBOUND) {
    const bodyLen = (result.text ?? '').length;
    if (bodyLen < 3_000) return true;
  }
  return false;
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

/** URLs the model may put on Open buttons this turn (fetched pages + outbound). */
export function collectAllowedSuggestionUrls(batch: LinkFetchBatch): Set<string> {
  const allowed = new Set<string>();
  for (const result of batch.results) {
    if (!result.ok) continue;
    try {
      allowed.add(new URL(result.url).href);
    } catch {
      // skip
    }
    for (const link of result.outboundLinks ?? []) {
      try {
        allowed.add(new URL(link.url).href);
      } catch {
        // skip
      }
    }
  }
  return allowed;
}

function normalizeSuggestionUrl(raw: string): string | null {
  try {
    const parsed = new URL(raw.trim());
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.href;
  } catch {
    return null;
  }
}

function normalizeMatchText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function pathMatchText(url: string): string {
  try {
    return normalizeMatchText(new URL(url).pathname);
  } catch {
    return '';
  }
}

/** Shared significant tokens / smaller set size (0–1). */
export function tokenOverlapScore(a: string, b: string): number {
  const as = new Set(
    normalizeMatchText(a)
      .split(' ')
      .filter((t) => t.length > 2),
  );
  const bs = new Set(
    normalizeMatchText(b)
      .split(' ')
      .filter((t) => t.length > 2),
  );
  if (!as.size || !bs.size) return 0;
  let inter = 0;
  for (const t of as) {
    if (bs.has(t)) inter += 1;
  }
  return inter / Math.min(as.size, bs.size);
}

function collectOutboundCatalog(batch: LinkFetchBatch): OutboundLink[] {
  const catalog: OutboundLink[] = [];
  const seen = new Set<string>();
  for (const result of batch.results) {
    if (!result.ok) continue;
    for (const link of result.outboundLinks ?? []) {
      const href = normalizeSuggestionUrl(link.url);
      if (!href || seen.has(href)) continue;
      seen.add(href);
      catalog.push({
        title: link.title,
        url: href,
        teaser: link.teaser,
      });
    }
  }
  return catalog;
}

/**
 * Map a model-suggested title/URL onto a real outbound link from this turn.
 * Exact URL first, then path/title fuzzy match (handles slightly wrong slugs).
 */
export function resolveToOutboundLink(
  batch: LinkFetchBatch,
  title: string,
  rawUrl: string,
): OutboundLink | null {
  const catalog = collectOutboundCatalog(batch);
  if (!catalog.length) return null;

  const url = normalizeSuggestionUrl(rawUrl);
  if (url) {
    const exact = catalog.find((link) => link.url === url);
    if (exact) return exact;
  }

  if (url) {
    const wantPath = pathMatchText(url);
    let best: OutboundLink | null = null;
    let bestScore = 0;
    for (const link of catalog) {
      const score = tokenOverlapScore(wantPath, pathMatchText(link.url));
      if (score > bestScore) {
        bestScore = score;
        best = link;
      }
    }
    // Require solid overlap so we don't snap to an unrelated story.
    if (best && bestScore >= 0.6) return best;
  }

  const wantTitle = normalizeMatchText(title);
  if (wantTitle.length >= 10) {
    let best: OutboundLink | null = null;
    let bestScore = 0;
    for (const link of catalog) {
      const score = tokenOverlapScore(wantTitle, link.title);
      if (score > bestScore) {
        bestScore = score;
        best = link;
      }
    }
    if (best && bestScore >= 0.55) return best;
  }

  return null;
}

function titleForAllowedUrl(batch: LinkFetchBatch, url: string): string {
  for (const result of batch.results) {
    if (!result.ok) continue;
    try {
      if (new URL(result.url).href === url) {
        return result.title?.trim() || url;
      }
    } catch {
      // continue
    }
    for (const link of result.outboundLinks ?? []) {
      try {
        if (new URL(link.url).href === url) return link.title;
      } catch {
        // continue
      }
    }
  }
  return url;
}

/** Parse markdown [title](url) pairs from assistant text. */
export function parseMarkdownLinks(text: string): SuggestedLink[] {
  if (!text) return [];
  const found: SuggestedLink[] = [];
  const seen = new Set<string>();
  const re = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const title = collapseWhitespace(match[1] ?? '');
    const url = normalizeSuggestionUrl(match[2] ?? '');
    if (!title || !url || seen.has(url)) continue;
    seen.add(url);
    found.push({ title, url });
  }
  return found;
}

type SuggestLinksToolArgs = {
  links?: Array<{ title?: unknown; url?: unknown; teaser?: unknown }>;
};

/**
 * Build up to SUGGESTED_LINKS_MAX Open-button links from tool args, then markdown.
 * Model URLs are snapped to this turn's outbound set (exact or fuzzy title/path).
 */
export async function buildSuggestedLinks(options: {
  batch: LinkFetchBatch;
  toolArgs?: SuggestLinksToolArgs | null;
  responseText?: string;
}): Promise<SuggestedLink[]> {
  const catalog = collectOutboundCatalog(options.batch);
  if (!catalog.length && !collectAllowedSuggestionUrls(options.batch).size) {
    return [];
  }

  const candidates: SuggestedLink[] = [];
  const seen = new Set<string>();

  const pushCandidate = (title: string, rawUrl: string, teaser?: string) => {
    if (candidates.length >= SUGGESTED_LINKS_MAX) return;
    const resolved =
      resolveToOutboundLink(options.batch, title, rawUrl) ||
      (() => {
        // Allow the fetched page URL itself if the model links it.
        const href = normalizeSuggestionUrl(rawUrl);
        if (!href) return null;
        const allowed = collectAllowedSuggestionUrls(options.batch);
        if (!allowed.has(href)) return null;
        return {
          title: collapseWhitespace(title) || titleForAllowedUrl(options.batch, href),
          url: href,
          teaser,
        } as OutboundLink;
      })();
    if (!resolved) return;
    const url = resolved.url;
    if (seen.has(url)) return;
    seen.add(url);
    const cleanTitle =
      collapseWhitespace(title) ||
      resolved.title ||
      titleForAllowedUrl(options.batch, url);
    if (!cleanTitle) return;
    const cleanTeaser =
      collapseWhitespace(teaser || '') ||
      resolved.teaser ||
      teaserForUrl(options.batch, url);
    candidates.push(
      cleanTeaser
        ? { title: cleanTitle, url, teaser: cleanTeaser }
        : { title: cleanTitle, url },
    );
  };

  const toolLinks = options.toolArgs?.links;
  if (Array.isArray(toolLinks)) {
    for (const item of toolLinks) {
      if (!item || typeof item !== 'object') continue;
      const title = typeof item.title === 'string' ? item.title : '';
      const url = typeof item.url === 'string' ? item.url : '';
      const teaser = typeof item.teaser === 'string' ? item.teaser : undefined;
      pushCandidate(title, url, teaser);
    }
  }

  if (candidates.length < SUGGESTED_LINKS_MAX && options.responseText) {
    for (const link of parseMarkdownLinks(options.responseText)) {
      pushCandidate(link.title, link.url);
    }
  }

  return verifySuggestedLinkCandidates(candidates);
}

/**
 * When the LLM is SAFETY-blocked (or returns nothing), pick outbound headlines
 * from this turn's fetch so the student still gets Read-link buttons.
 */
export async function pickOutboundSuggestedLinks(
  batch: LinkFetchBatch,
  max = SUGGESTED_LINKS_MAX,
): Promise<SuggestedLink[]> {
  const candidates: SuggestedLink[] = [];
  const seen = new Set<string>();

  for (const result of batch.results) {
    if (!result.ok || !result.outboundLinks?.length) continue;
    let pageHost = '';
    try {
      pageHost = new URL(result.url).hostname.toLowerCase();
    } catch {
      pageHost = '';
    }
    const pageHref = normalizeSuggestionUrl(result.url);

    const ranked = [...result.outboundLinks].sort((a, b) => {
      const hostOf = (raw: string) => {
        try {
          return new URL(raw).hostname.toLowerCase();
        } catch {
          return '';
        }
      };
      const aSame = pageHost && hostOf(a.url) === pageHost ? 1 : 0;
      const bSame = pageHost && hostOf(b.url) === pageHost ? 1 : 0;
      if (aSame !== bSame) return bSame - aSame;
      const aTeaser = a.teaser ? 1 : 0;
      const bTeaser = b.teaser ? 1 : 0;
      return bTeaser - aTeaser;
    });

    for (const link of ranked) {
      if (candidates.length >= max) break;
      const url = normalizeSuggestionUrl(link.url);
      if (!url || seen.has(url) || url === pageHref) continue;
      // Skip very short chrome titles.
      const title = collapseWhitespace(link.title);
      if (!title || title.length < 12) continue;
      seen.add(url);
      candidates.push(
        link.teaser
          ? { title, url, teaser: link.teaser }
          : { title, url },
      );
    }
  }

  return verifySuggestedLinkCandidates(candidates);
}

async function verifySuggestedLinkCandidates(
  candidates: SuggestedLink[],
): Promise<SuggestedLink[]> {
  const verified: SuggestedLink[] = [];
  for (const link of candidates) {
    try {
      const safe = await assertUrlSafeToFetch(link.url);
      verified.push(
        link.teaser
          ? { title: link.title, url: safe.href, teaser: link.teaser }
          : { title: link.title, url: safe.href },
      );
    } catch {
      // drop unsafe / unresolvable
    }
    if (verified.length >= SUGGESTED_LINKS_MAX) break;
  }
  return verified;
}

function teaserForUrl(batch: LinkFetchBatch | undefined, url: string): string | undefined {
  if (!batch) return undefined;
  for (const result of batch.results) {
    if (!result.ok) continue;
    for (const link of result.outboundLinks ?? []) {
      try {
        if (new URL(link.url).href === url && link.teaser?.trim()) {
          return link.teaser.trim();
        }
      } catch {
        // continue
      }
    }
  }
  return undefined;
}

/**
 * User-facing reply when the model called suggest_openable_links but returned no prose,
 * or when SAFETY blocked and we fall back to outbound headlines.
 */
export function buildSuggestedLinksReply(
  links: SuggestedLink[],
  batch?: LinkFetchBatch,
  options?: { degraded?: boolean },
): string {
  if (!links.length) return '';
  const lines: string[] = [
    options?.degraded
      ? 'I could not get an AI write-up for that page just now, but here are headlines from it that may relate to your course:'
      : 'These look most relevant to your course right now:',
    '',
  ];
  links.forEach((link, index) => {
    const teaser = link.teaser?.trim() || teaserForUrl(batch, link.url);
    const teaserBit = teaser ? ` — ${teaser}` : '';
    lines.push(`${index + 1}. [${link.title}](${link.url})${teaserBit}`);
  });
  lines.push(
    '',
    'Use a **Read link** button below if you want me to read one of these pages in detail.',
  );
  return lines.join('\n');
}
