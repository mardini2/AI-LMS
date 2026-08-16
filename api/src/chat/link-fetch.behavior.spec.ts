import {
  assertUrlSafeToFetch,
  buildLinkFetchPromptBlock,
  buildSuggestedLinks,
  buildSuggestedLinksReply,
  extractHttpUrls,
  extractOutboundLinks,
  fetchOneLinkedPage,
  htmlToPlainText,
  isBlockedHostname,
  isPrivateOrReservedIp,
  linkFetchWarningMessages,
  looksLikeListingPage,
  parseMarkdownLinks,
  pickOutboundSuggestedLinks,
  resolveToOutboundLink,
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

  it('extracts outbound links with absolute URLs and teasers', () => {
    const html = `
      <html><body>
        <a href="/stories/rootkit-deep-dive">Rootkit deep dive</a>
        Attackers hide in the kernel using advanced hooks and stealth.
        <a href="https://other.example/share/twitter">Share</a>
        <a href="#top">Back to top</a>
        <a href="https://cdn.example.com/post">External post</a>
        Brief note about the external write-up on loaders.
      </body></html>
    `;
    const links = extractOutboundLinks(html, 'https://news.example.com/');
    expect(links[0]).toMatchObject({
      title: 'Rootkit deep dive',
      url: 'https://news.example.com/stories/rootkit-deep-dive',
    });
    expect(links[0].teaser).toMatch(/Attackers hide in the kernel/i);
    expect(links.some((l) => /share|twitter|#top/i.test(l.url))).toBe(false);
    expect(links.some((l) => l.url === 'https://cdn.example.com/post')).toBe(true);
    // Same-host preferred first.
    expect(links[0].url).toContain('news.example.com');
  });

  it('upgrades duplicate story URLs with a better title and home-desc teaser', () => {
    const html = `
      <html><body>
        <a href="/2026/08/linux-sctp-flaw.html"><img alt="thumb" src="/t.jpg"></a>
        <h2><a href="/2026/08/linux-sctp-flaw.html">18-Year-Old Linux SCTP Flaw</a></h2>
        <div class="item-label">August 9, 2026</div>
        <div class="home-desc">A use-after-free in the Linux SCTP stack can let local users escalate to root.</div>
        <a href="/2026/08/other.html">Other story</a>
      </body></html>
    `;
    const links = extractOutboundLinks(html, 'https://thehackernews.com/');
    const sctp = links.find((l) => l.url.includes('linux-sctp-flaw'));
    expect(sctp?.title).toMatch(/18-Year-Old Linux SCTP Flaw/);
    expect(sctp?.teaser).toMatch(/use-after-free in the Linux SCTP/i);
  });

  it('extracts title and teaser from a THN-style story-link card', () => {
    const html = `
      <a class='story-link' href="https://thehackernews.com/2026/08/atlassian-rovo-can-be-tricked-into.html">
        <div class='home-post-box'>
          <img alt='Atlassian Rovo Can Be Tricked Into Sending Jira and Confluence Data to Attackers' src='/x.jpg' />
          <h2 class='home-title'>Atlassian Rovo Can Be Tricked Into Sending Jira and Confluence Data to Attackers</h2>
          <div class='item-label'>August 9, 2026</div>
          <div class='home-desc'> Attacker-controlled instructions can make Atlassian&#39;s Rovo assistant collect Jira or Confluence data.</div>
        </div>
      </a>
    `;
    const links = extractOutboundLinks(html, 'https://thehackernews.com/');
    expect(links).toHaveLength(1);
    expect(links[0].title).toBe(
      'Atlassian Rovo Can Be Tricked Into Sending Jira and Confluence Data to Attackers',
    );
    expect(links[0].teaser).toMatch(/Attacker-controlled instructions/i);
    expect(links[0].teaser).not.toMatch(/August 9/i);
  });

  it('fetches a public HTML page through the injected fetch', async () => {
    const fetchImpl = jest.fn(async () => {
      return new Response(
        `<html><head><title>OS Notes</title></head><body>
          <p>Semaphores protect critical sections.</p>
          <a href="/more">More on semaphores</a> A short follow-up blurb about mutexes and waits.
        </body></html>`,
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
      expect(result.outboundLinks?.[0]).toMatchObject({
        title: 'More on semaphores',
        url: 'https://example.com/more',
      });
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
          outboundLinks: [
            {
              title: 'Related story',
              url: 'https://example.com/related',
              teaser: 'A short blurb about related research.',
            },
          ],
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
    expect(block).toMatch(/Outbound links on page/);
    expect(block).toMatch(/Related story — https:\/\/example.com\/related/);
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

  it('parses markdown links and builds suggested links from tool + fallback', async () => {
    expect(
      parseMarkdownLinks(
        'See [Alpha](https://example.com/a) and [Beta](https://example.com/b).',
      ),
    ).toEqual([
      { title: 'Alpha', url: 'https://example.com/a' },
      { title: 'Beta', url: 'https://example.com/b' },
    ]);

    const batch = {
      results: [
        {
          url: 'https://example.com/home',
          ok: true as const,
          text: 'Home',
          contentType: 'text/html',
          outboundLinks: [
            { title: 'Story A', url: 'https://example.com/a' },
            { title: 'Story B', url: 'https://example.com/b' },
            { title: 'Story C', url: 'https://example.com/c' },
          ],
        },
      ],
      totalUrls: 1,
      skippedUrls: 0,
    };

    const fromTool = await buildSuggestedLinks({
      batch,
      toolArgs: {
        links: [
          { title: 'Story A', url: 'https://example.com/a' },
          { title: 'Invented', url: 'https://evil.example/x' },
          { title: 'Story B', url: 'https://example.com/b' },
        ],
      },
    });
    expect(fromTool).toEqual([
      { title: 'Story A', url: 'https://example.com/a' },
      { title: 'Story B', url: 'https://example.com/b' },
    ]);

    const fromMarkdown = await buildSuggestedLinks({
      batch,
      responseText:
        'Try [Story C](https://example.com/c) and [Nope](https://other.example/z).',
    });
    expect(fromMarkdown).toEqual([{ title: 'Story C', url: 'https://example.com/c' }]);
  });

  it('synthesizes a markdown recommendation reply from suggested links', () => {
    const reply = buildSuggestedLinksReply(
      [
        {
          title: 'Story A',
          url: 'https://example.com/a',
          teaser: 'Kernel hooks and stealth.',
        },
        { title: 'Story B', url: 'https://example.com/b' },
      ],
      {
        results: [
          {
            url: 'https://example.com/home',
            ok: true,
            text: 'Home',
            contentType: 'text/html',
            outboundLinks: [
              {
                title: 'Story B',
                url: 'https://example.com/b',
                teaser: 'From outbound extract only.',
              },
            ],
          },
        ],
        totalUrls: 1,
        skippedUrls: 0,
      },
    );
    expect(reply).toMatch(/most relevant to your course/i);
    expect(reply).toMatch(/\[Story A\]\(https:\/\/example\.com\/a\) — Kernel hooks and stealth/);
    expect(reply).toMatch(/\[Story B\]\(https:\/\/example\.com\/b\) — From outbound extract only/);
    expect(reply).toMatch(/Read link/i);
  });

  it('omits full body for listing pages and keeps outbound headlines', () => {
    const outbound = Array.from({ length: 6 }, (_, i) => ({
      title: `Story headline number ${i + 1} with enough length`,
      url: `https://news.example.com/story-${i + 1}`,
      teaser: `Teaser blurb for story ${i + 1} about security research.`,
    }));
    const page = {
      url: 'https://news.example.com/',
      ok: true as const,
      title: 'News Home',
      text: 'Huge body of exploit details that should not be dumped into the prompt. '.repeat(20),
      contentType: 'text/html',
      outboundLinks: outbound,
    };
    expect(looksLikeListingPage(page)).toBe(true);
    const block = buildLinkFetchPromptBlock({
      results: [page],
      totalUrls: 1,
      skippedUrls: 0,
    });
    expect(block).toMatch(/Listing\/homepage note/i);
    expect(block).toMatch(/Story headline number 1/);
    expect(block).toMatch(/Teaser blurb for story 1/);
    expect(block).not.toMatch(/Huge body of exploit details/);
  });

  it('picks outbound headlines when the model is unavailable', async () => {
    const batch = {
      results: [
        {
          url: 'https://example.com/',
          ok: true as const,
          text: 'Home',
          contentType: 'text/html',
          outboundLinks: [
            {
              title: 'First long enough headline about rootkits',
              url: 'https://example.com/a',
              teaser: 'Kernel stealth techniques.',
            },
            {
              title: 'Second long enough headline about malware',
              url: 'https://example.com/b',
            },
            { title: 'Short', url: 'https://example.com/c' },
          ],
        },
      ],
      totalUrls: 1,
      skippedUrls: 0,
    };
    const links = await pickOutboundSuggestedLinks(batch);
    expect(links).toHaveLength(2);
    expect(links[0].title).toMatch(/First long enough/);
    expect(links[0].teaser).toMatch(/Kernel stealth/);
    expect(links[1].url).toBe('https://example.com/b');
  });

  it('does not treat dated article URLs as listing pages even with many outbound links', () => {
    const outbound = Array.from({ length: 8 }, (_, i) => ({
      title: `Related story headline ${i + 1} with enough length`,
      url: `https://thehackernews.com/2026/07/related-${i + 1}.html`,
    }));
    const article = {
      url: 'https://thehackernews.com/2026/08/n-central-attackers-reach-managed.html',
      ok: true as const,
      title: 'N-central article',
      text: 'Long article body about persistence and managed systems. '.repeat(80),
      contentType: 'text/html',
      outboundLinks: outbound,
    };
    expect(looksLikeListingPage(article)).toBe(false);
    const block = buildLinkFetchPromptBlock({
      results: [article],
      totalUrls: 1,
      skippedUrls: 0,
    });
    expect(block).not.toMatch(/Listing\/homepage note/i);
    expect(block).toMatch(/Long article body about persistence/);
  });

  it('snaps slightly wrong model URLs to outbound links for Read buttons', async () => {
    const batch = {
      results: [
        {
          url: 'https://thehackernews.com/2026/08/n-central-attackers-reach-managed.html',
          ok: true as const,
          text: 'Article body',
          contentType: 'text/html',
          outboundLinks: [
            {
              title: 'Critical SharePoint RCE CVE-2026-50522 Under Active Exploitation',
              url: 'https://thehackernews.com/2026/07/critical-sharepoint-rce-cve-2026-50522.html',
              teaser: 'Active RCE exploitation details.',
            },
            {
              title: 'Ubuntu snap-confine Flaw Could Give Local Users Root',
              url: 'https://thehackernews.com/2026/07/ubuntu-snap-confine-flaw-could-give.html',
            },
            {
              title: 'Certighost Exploit Lets Low-Privileged AD Users Impersonate a DC',
              url: 'https://thehackernews.com/2026/07/certighost-exploit-lets.html',
            },
          ],
        },
      ],
      totalUrls: 1,
      skippedUrls: 0,
    };

    const resolved = resolveToOutboundLink(
      batch,
      'Critical SharePoint RCE CVE-2026-50522 Under Active Exploitation After Public PoC',
      'https://thehackernews.com/2026/07/critical-sharepoint-cve-2026-50522.html',
    );
    expect(resolved?.url).toBe(
      'https://thehackernews.com/2026/07/critical-sharepoint-rce-cve-2026-50522.html',
    );

    const suggested = await buildSuggestedLinks({
      batch,
      responseText: `
* [Critical SharePoint RCE CVE-2026-50522 Under Active Exploitation After Public PoC](https://thehackernews.com/2026/07/critical-sharepoint-cve-2026-50522.html)
* [Ubuntu snap-confine Flaw Could Give Local Users Root on Default Desktop Installs](https://thehackernews.com/2026/07/ubuntu-snap-confine-flaw-could-give.html)
* [Certighost Exploit Lets Low-Privileged Active Directory Users Impersonate a Domain Controller](https://thehackernews.com/2026/07/certighost-exploit-lets.html)
`,
    });
    expect(suggested).toHaveLength(3);
    expect(suggested.map((l) => l.url)).toEqual([
      'https://thehackernews.com/2026/07/critical-sharepoint-rce-cve-2026-50522.html',
      'https://thehackernews.com/2026/07/ubuntu-snap-confine-flaw-could-give.html',
      'https://thehackernews.com/2026/07/certighost-exploit-lets.html',
    ]);
  });
});
