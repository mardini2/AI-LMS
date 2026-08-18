import { describe, expect, it } from '@jest/globals';
import {
  buildStudyGuideContextFilter,
  buildStudyGuideProposalMessage,
  escapeHtml,
  markdownToSafeHtml,
  normalizeStudyGuideDocument,
  renderStudyGuideHtml,
  sanitizeStudyGuideHtml,
  scrubStudyGuideContext,
  stripUnsafeText,
  type StudyGuideDocument,
} from '../../../src/chat/study-guide.helpers';

describe('scrubStudyGuideContext', () => {
  it('removes source URLs and collapses the leftover whitespace', () => {
    expect(
      scrubStudyGuideContext(
        'Slide 1; source=https://lms.test/a\n\n\n\nSlide 2 see https://x.test/y  ok',
      ),
    ).toBe('Slide 1\n\nSlide 2 see ok');
  });
});

describe('buildStudyGuideContextFilter', () => {
  it('hard-scopes on sectionIds and drops non-positive ids', () => {
    expect(
      buildStudyGuideContextFilter({
        sectionIds: [3, 0, -2, 7],
        sectionNumbers: [],
        sectionId: 99,
        sectionNumber: 4,
        sectionName: 'Week 4',
      }),
    ).toEqual({
      sectionIds: [3, 7],
      sectionNumbers: [],
      hardSectionScope: true,
    });
  });

  it('hard-scopes on sectionNumbers when no ids are given', () => {
    expect(
      buildStudyGuideContextFilter({
        sectionIds: [],
        sectionNumbers: [5, 6],
      }),
    ).toEqual({
      sectionIds: [],
      sectionNumbers: [5, 6],
      hardSectionScope: true,
    });
  });

  it('falls back to the soft single-section filter when nothing hard-scopes', () => {
    expect(
      buildStudyGuideContextFilter({
        sectionId: 12,
        sectionNumber: 3,
        sectionName: 'Paging',
      }),
    ).toEqual({
      sectionId: 12,
      sectionNumber: 3,
      sectionName: 'Paging',
    });
  });

  it('treats an all-zero id list as unscoped', () => {
    expect(
      buildStudyGuideContextFilter({
        sectionIds: [0, -1],
        sectionName: 'Week 1',
      }),
    ).toEqual({
      sectionId: undefined,
      sectionNumber: undefined,
      sectionName: 'Week 1',
    });
  });
});

describe('buildStudyGuideProposalMessage', () => {
  it('renders the confirm/cancel proposal with title and scope', () => {
    const message = buildStudyGuideProposalMessage({
      title: 'Paging and TLBs',
      scopeSummary: 'Week 5 lecture notes',
    });

    expect(message).toBe(
      [
        'I can create a **private study guide** Page in Moodle for you.',
        '',
        '**Paging and TLBs**',
        '- Covers: Week 5 lecture notes',
        '- Formatted study notes (concepts, procedures, key takeaways)',
        '- Practice aid only — not graded',
        '- Placed under **AI Content** (only you and instructors can see it)',
        '',
        'Nothing will be created until you press **Confirm**. Use **Cancel** to discard this plan.',
      ].join('\n'),
    );
  });
});

describe('normalizeStudyGuideDocument', () => {
  it('returns null for null and undefined input', () => {
    expect(normalizeStudyGuideDocument(null)).toBeNull();
    expect(normalizeStudyGuideDocument(undefined)).toBeNull();
  });

  it('returns null when the title is missing or blank', () => {
    expect(
      normalizeStudyGuideDocument({
        title: '   ',
        sections: [{ heading: 'H', bodyMarkdown: 'B' }],
      }),
    ).toBeNull();
    expect(
      normalizeStudyGuideDocument({
        sections: [{ heading: 'H', bodyMarkdown: 'B' }],
      }),
    ).toBeNull();
  });

  it('returns null when there are no usable sections', () => {
    expect(normalizeStudyGuideDocument({ title: 'T', sections: [] })).toBeNull();
    expect(normalizeStudyGuideDocument({ title: 'T' })).toBeNull();
  });

  it('drops sections that are missing a heading or a body', () => {
    const doc = normalizeStudyGuideDocument({
      title: 'Memory',
      sections: [
        { heading: 'Good', bodyMarkdown: 'Body text' },
        { heading: '', bodyMarkdown: 'Orphan body' },
        { heading: 'No body', bodyMarkdown: '   ' },
        { heading: 'Second', bodyMarkdown: 'More body' },
      ],
    });

    expect(doc).toEqual({
      title: 'Memory',
      introMarkdown: undefined,
      sections: [
        { heading: 'Good', bodyMarkdown: 'Body text' },
        { heading: 'Second', bodyMarkdown: 'More body' },
      ],
    });
  });

  it('survives null entries and coerces non-string section fields', () => {
    const doc = normalizeStudyGuideDocument({
      title: 'Coercion',
      sections: [
        null,
        undefined,
        { heading: 5, bodyMarkdown: 7 },
      ],
    } as never);

    expect(doc?.sections).toEqual([{ heading: '5', bodyMarkdown: '7' }]);
  });

  it('strips HTML tags and URLs out of title, intro and sections', () => {
    const doc = normalizeStudyGuideDocument({
      title: '<b>Paging</b> notes',
      introMarkdown: 'Read [the docs](https://example.com/docs) first',
      sections: [
        {
          heading: '<script>alert(1)</script>TLB',
          bodyMarkdown: 'See https://evil.com/x and www.evil.com for more',
        },
      ],
    });

    expect(doc?.title).toBe('Paging notes');
    expect(doc?.introMarkdown).toBe('Read the docs first');
    expect(doc?.sections[0].heading).toBe('alert(1) TLB');
    expect(doc?.sections[0].bodyMarkdown).toBe('See and for more');
  });

  it('collapses blank lines inside section bodies', () => {
    const doc = normalizeStudyGuideDocument({
      title: 'Lists',
      sections: [{ heading: 'Items', bodyMarkdown: '- one\n\n- two' }],
    });

    expect(doc?.sections[0].bodyMarkdown).toBe('- one - two');
  });

  it('drops an intro that becomes empty after scrubbing', () => {
    const doc = normalizeStudyGuideDocument({
      title: 'T',
      introMarkdown: 'https://only-a-link.example.com/page',
      sections: [{ heading: 'H', bodyMarkdown: 'B' }],
    });

    expect(doc?.introMarkdown).toBeUndefined();
  });

  it('caps the title at 200 characters and the sections at 12', () => {
    const doc = normalizeStudyGuideDocument({
      title: 'A'.repeat(250),
      sections: Array.from({ length: 15 }, (_, i) => ({
        heading: `H${i}`,
        bodyMarkdown: `B${i}`,
      })),
    });

    expect(doc?.title).toHaveLength(200);
    expect(doc?.sections).toHaveLength(12);
    expect(doc?.sections[11]).toEqual({ heading: 'H11', bodyMarkdown: 'B11' });
  });
});

describe('renderStudyGuideHtml', () => {
  const doc: StudyGuideDocument = {
    title: 'Paging',
    introMarkdown: 'Quick **refresher** before the exam.',
    sections: [
      { heading: 'Address translation', bodyMarkdown: 'Virtual to physical.' },
      { heading: 'TLB', bodyMarkdown: 'Caches translations.' },
    ],
  };

  it('wraps the guide in the syll-sg marker div and closes it', () => {
    const html = renderStudyGuideHtml(doc);

    expect(html.startsWith('<div class="syll-sg" data-syll-sg="1">\n')).toBe(
      true,
    );
    expect(
      html.endsWith(
        '<p><em>Private study guide created by Syllentras AI. This is a practice aid and is not graded.</em></p>\n</div>',
      ),
    ).toBe(true);
  });

  it('renders the intro markdown and each section heading and body', () => {
    const html = renderStudyGuideHtml(doc);

    expect(html).toContain('<strong>refresher</strong>');
    expect(html).toContain('<h2>Address translation</h2>');
    expect(html).toContain('<p>Virtual to physical.</p>');
    expect(html).toContain('<h2>TLB</h2>');
    expect(html).toContain('<p>Caches translations.</p>');
    expect(html.indexOf('<h2>Address translation</h2>')).toBeLessThan(
      html.indexOf('<h2>TLB</h2>'),
    );
  });

  it('omits the intro block entirely when there is no intro', () => {
    const html = renderStudyGuideHtml({
      title: 'T',
      sections: [{ heading: 'H', bodyMarkdown: 'Body' }],
    });

    expect(html.split('\n')[1]).toBe('<h2>H</h2>');
  });

  it('escapes untrusted heading text instead of emitting live markup', () => {
    const html = renderStudyGuideHtml({
      title: 'T',
      sections: [
        {
          heading: '<script>alert("x")</script> A & B\'s "quotes"',
          bodyMarkdown: 'Body',
        },
      ],
    });

    expect(html).toContain(
      '<h2>&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; A &amp; B&#39;s &quot;quotes&quot;</h2>',
    );
    expect(html).not.toContain('<script>');
  });

  it('drops a section body that sanitizes away to nothing', () => {
    const html = renderStudyGuideHtml({
      title: 'T',
      sections: [{ heading: 'Bad', bodyMarkdown: '<script>steal()</script>' }],
    });

    expect(html).not.toContain('steal()');
    expect(html.split('\n')).toEqual([
      '<div class="syll-sg" data-syll-sg="1">',
      '<h2>Bad</h2>',
      '<p><em>Private study guide created by Syllentras AI. This is a practice aid and is not graded.</em></p>',
      '</div>',
    ]);
  });
});

describe('stripUnsafeText', () => {
  it('keeps markdown link text and drops the target', () => {
    expect(stripUnsafeText('See [the docs](https://e.com/a) now')).toBe(
      'See the docs now',
    );
    expect(stripUnsafeText('Mail [us](mailto:a@b.com) today')).toBe(
      'Mail us today',
    );
  });

  it('removes bare http and www URLs', () => {
    expect(stripUnsafeText('Visit https://evil.com/path now')).toBe(
      'Visit now',
    );
    expect(stripUnsafeText('Go to www.evil.com today')).toBe('Go to today');
  });

  it('removes HTML tags but keeps their text content', () => {
    expect(stripUnsafeText('Hello <b>world</b> <script>x</script>')).toBe(
      'Hello world x',
    );
  });

  it('collapses runs of whitespace and trims', () => {
    expect(stripUnsafeText('  a\n\n   b  ')).toBe('a b');
  });

  it('leaves a single newline intact', () => {
    expect(stripUnsafeText('a\nb')).toBe('a\nb');
  });

  it('returns an empty string for whitespace-only input', () => {
    expect(stripUnsafeText('   ')).toBe('');
  });
});

describe('markdownToSafeHtml', () => {
  it('renders emphasis and lists with allowlisted tags', () => {
    expect(markdownToSafeHtml('**bold** and *italic*')).toBe(
      '<p><strong>bold</strong> and <em>italic</em></p>',
    );
    expect(markdownToSafeHtml('- one\n- two')).toContain('<li>one</li>');
  });

  it('turns single newlines into <br> because breaks is enabled', () => {
    expect(markdownToSafeHtml('one\ntwo')).toBe('<p>one<br>two</p>');
  });

  it('removes script blocks together with their contents', () => {
    expect(markdownToSafeHtml('<script>alert(1)</script>')).toBe('');
  });

  it('keeps markdown link text but removes the anchor and the URL', () => {
    const html = markdownToSafeHtml('See [docs](https://example.com/x) now');

    expect(html).toContain('docs');
    expect(html).not.toContain('<a');
    expect(html).not.toContain('example.com');
  });

  it('drops images entirely', () => {
    expect(markdownToSafeHtml('![alt](https://x.com/i.png)')).not.toContain(
      '<img',
    );
  });
});

describe('sanitizeStudyGuideHtml', () => {
  it('strips attributes from allowlisted tags', () => {
    expect(sanitizeStudyGuideHtml('<p onclick="steal()">hi</p>')).toBe(
      '<p>hi</p>',
    );
  });

  it('removes non-allowlisted tags but keeps inner text', () => {
    expect(sanitizeStudyGuideHtml('<span>keep</span> me')).toBe('keep me');
    expect(sanitizeStudyGuideHtml('<iframe src="x"></iframe>done')).toBe(
      'done',
    );
  });

  it('removes script and style elements with their contents', () => {
    expect(sanitizeStudyGuideHtml('<style>p{color:red}</style><p>x</p>')).toBe(
      '<p>x</p>',
    );
    expect(sanitizeStudyGuideHtml('<script>alert(1)</script><p>x</p>')).toBe(
      '<p>x</p>',
    );
  });

  it('normalizes br and lowercases tag names', () => {
    expect(sanitizeStudyGuideHtml('a<BR />b</P>')).toBe('a<br>b</p>');
  });

  it('preserves the syll-sg wrapper div but flattens other divs', () => {
    expect(
      sanitizeStudyGuideHtml('<div class="syll-sg" data-syll-sg="1">x</div>'),
    ).toBe('<div class="syll-sg" data-syll-sg="1">x</div>');
    expect(sanitizeStudyGuideHtml('<div class="other">x</div>')).toBe(
      '<div>x</div>',
    );
  });

  it('removes bare URLs left in text', () => {
    expect(sanitizeStudyGuideHtml('<p>go https://evil.com/a now</p>')).toBe(
      '<p>go  now</p>',
    );
  });
});

describe('escapeHtml', () => {
  it('escapes ampersands, angle brackets and both quote styles', () => {
    expect(escapeHtml('<script>alert("x") & \'y\'</script>')).toBe(
      '&lt;script&gt;alert(&quot;x&quot;) &amp; &#39;y&#39;&lt;/script&gt;',
    );
  });

  it('escapes the ampersand of an already-escaped entity', () => {
    expect(escapeHtml('&lt;')).toBe('&amp;lt;');
  });

  it('leaves ordinary text untouched', () => {
    expect(escapeHtml('plain text 123')).toBe('plain text 123');
    expect(escapeHtml('')).toBe('');
  });
});
