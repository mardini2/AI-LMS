import {
  assertUrlSafeToFetch,
  buildLinkFetchPromptBlock,
  extractHttpUrls,
  fetchOneLinkedPage,
  htmlToPlainText,
  isBlockedHostname,
  isPrivateOrReservedIp,
  linkFetchWarningMessages,
} from './link-fetch';

describe('link fetch helpers', () => {
  it('extracts up to three http(s) urls and trims trailing junk', () => {
    const urls = extractHttpUrls(
      'See https://example.com/a. also http://docs.example.org/path?x=1), and https://news.example.net/story!',
    );
    expect(urls).toEqual([
      'https://example.com/a',
      'http://docs.example.org/path?x=1',
      'https://news.example.net/story',
    ]);
  });

  it('blocks private hosts and IPs', () => {
    expect(isBlockedHostname('localhost')).toBe(true);
    expect(isBlockedHostname('foo.local')).toBe(true);
    expect(isPrivateOrReservedIp('127.0.0.1')).toBe(true);
    expect(isPrivateOrReservedIp('10.0.0.5')).toBe(true);
    expect(isPrivateOrReservedIp('192.168.1.1')).toBe(true);
    expect(isPrivateOrReservedIp('169.254.169.254')).toBe(true);
    expect(isPrivateOrReservedIp('8.8.8.8')).toBe(false);
  });

  it('rejects literal private IPs in assertUrlSafeToFetch', async () => {
    await expect(assertUrlSafeToFetch('http://127.0.0.1/secret')).rejects.toThrow(
      /private or local/i,
    );
    await expect(assertUrlSafeToFetch('http://192.168.0.10/x')).rejects.toThrow(
      /private or local/i,
    );
  });

  it('turns simple HTML into plain text with a title', () => {
    const { title, text } = htmlToPlainText(`
      <html><head><title>Week 3 Notes</title></head>
      <body>
        <h1>Paging</h1>
        <p>Pages map to frames.</p>
        <script>alert(1)</script>
      </body></html>
    `);
    expect(title).toBe('Week 3 Notes');
    expect(text).toMatch(/Paging/);
    expect(text).toMatch(/Pages map to frames/);
    expect(text).not.toMatch(/alert/);
  });

  it('fetches a public HTML page through the injected fetch', async () => {
    const fetchImpl = jest.fn(async () => {
      return new Response(
        '<html><head><title>OS Notes</title></head><body><p>Semaphores protect critical sections.</p></body></html>',
        {
          status: 200,
          headers: { 'content-type': 'text/html; charset=utf-8' },
        },
      );
    }) as unknown as typeof fetch;

    const result = await fetchOneLinkedPage('https://example.com/notes', {
      fetchImpl,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.title).toBe('OS Notes');
      expect(result.text).toMatch(/Semaphores protect critical sections/);
    }
    expect(fetchImpl).toHaveBeenCalled();
  });

  it('follows one redirect only after re-checking the next URL', async () => {
    const fetchImpl = jest.fn(async (input: RequestInfo | URL) => {
      const href = String(input);
      if (href.includes('/start')) {
        return new Response(null, {
          status: 302,
          headers: { location: 'https://example.com/final' },
        });
      }
      return new Response('<html><body><p>Final page body</p></body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      });
    }) as unknown as typeof fetch;

    const result = await fetchOneLinkedPage('https://example.com/start', {
      fetchImpl,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.text).toMatch(/Final page body/);
    }
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('refuses redirects that land on a private IP', async () => {
    const fetchImpl = jest.fn(async () => {
      return new Response(null, {
        status: 302,
        headers: { location: 'http://127.0.0.1/admin' },
      });
    }) as unknown as typeof fetch;

    const result = await fetchOneLinkedPage('https://example.com/redir', {
      fetchImpl,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/private or local/i);
    }
  });

  it('builds a prompt block and warning list', () => {
    const block = buildLinkFetchPromptBlock({
      results: [
        {
          url: 'https://example.com/a',
          ok: true,
          title: 'A',
          text: 'Hello',
          contentType: 'text/html',
        },
        {
          url: 'https://example.com/b',
          ok: false,
          error: 'Timed out while opening that link.',
        },
      ],
      totalUrls: 2,
      skippedUrls: 0,
    });
    expect(block).toMatch(/Linked page content/);
    expect(block).toMatch(/Hello/);
    expect(block).toMatch(/Linked page failed/);
    expect(
      linkFetchWarningMessages({
        results: [
          {
            url: 'https://example.com/b',
            ok: false,
            error: 'Timed out while opening that link.',
          },
        ],
        totalUrls: 1,
        skippedUrls: 0,
      }),
    ).toEqual(['Could not open link: Timed out while opening that link.']);
  });

  it('tells the model and UI when more than 3 links were shared', () => {
    const batch = {
      results: [
        {
          url: 'https://example.com/1',
          ok: true as const,
          text: 'One',
          contentType: 'text/html',
        },
        {
          url: 'https://example.com/2',
          ok: true as const,
          text: 'Two',
          contentType: 'text/html',
        },
        {
          url: 'https://example.com/3',
          ok: true as const,
          text: 'Three',
          contentType: 'text/html',
        },
      ],
      totalUrls: 4,
      skippedUrls: 1,
    };
    const block = buildLinkFetchPromptBlock(batch);
    expect(block).toMatch(/Limit note/i);
    expect(block).toMatch(/4 links/i);
    expect(block).toMatch(/MUST briefly tell them/i);
    expect(linkFetchWarningMessages(batch)).toEqual([
      'I can open up to 3 links per message — opened the first 3 of 4. Send the rest in a follow-up if you want those too.',
    ]);
  });
});
