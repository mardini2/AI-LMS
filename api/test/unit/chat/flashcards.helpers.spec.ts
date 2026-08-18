import { describe, expect, it } from '@jest/globals';
import {
  buildFlashcardsContextFilter,
  buildFlashcardsProposalMessage,
  clampCardCount,
  normalizeFlashcardsDocument,
  renderFlashcardsHtml,
  scrubFlashcardsContext,
  FLASHCARD_COUNT_AUTO_MAX,
  FLASHCARD_COUNT_DEFAULT,
  FLASHCARD_COUNT_EXPLICIT_MAX,
  FLASHCARD_COUNT_MIN,
} from '../../../src/chat/flashcards.helpers';

describe('scrubFlashcardsContext', () => {
  it('removes source URLs and collapses the leftover whitespace', () => {
    expect(
      scrubFlashcardsContext(
        'Slide 1; source=https://lms.test/a\n\n\n\nSlide 2 see https://x.test/y  ok',
      ),
    ).toBe('Slide 1\n\nSlide 2 see ok');
  });
});

describe('clampCardCount', () => {
  it('keeps in-range values and rounds fractional ones', () => {
    expect(clampCardCount(20, false)).toBe(20);
    expect(clampCardCount(12.4, false)).toBe(12);
    expect(clampCardCount(12.5, false)).toBe(13);
  });

  it('raises anything below the floor to the minimum', () => {
    expect(clampCardCount(1, false)).toBe(FLASHCARD_COUNT_MIN);
    expect(clampCardCount(0, true)).toBe(FLASHCARD_COUNT_MIN);
    expect(clampCardCount(-25, true)).toBe(FLASHCARD_COUNT_MIN);
  });

  it('caps at the auto maximum when the student did not name a count', () => {
    expect(clampCardCount(31, false)).toBe(FLASHCARD_COUNT_AUTO_MAX);
    expect(clampCardCount(500, false)).toBe(FLASHCARD_COUNT_AUTO_MAX);
    expect(clampCardCount(FLASHCARD_COUNT_AUTO_MAX, false)).toBe(30);
  });

  it('caps at the explicit maximum when the student named a count', () => {
    expect(clampCardCount(40, true)).toBe(FLASHCARD_COUNT_EXPLICIT_MAX);
    expect(clampCardCount(41, true)).toBe(FLASHCARD_COUNT_EXPLICIT_MAX);
    expect(clampCardCount(1000, true)).toBe(40);
  });

  it('parses numeric strings', () => {
    expect(clampCardCount('25', true)).toBe(25);
    expect(clampCardCount('9.7', false)).toBe(10);
  });

  it('falls back to the default for non-finite values', () => {
    expect(clampCardCount(undefined, false)).toBe(FLASHCARD_COUNT_DEFAULT);
    expect(clampCardCount('twelve', true)).toBe(FLASHCARD_COUNT_DEFAULT);
    expect(clampCardCount(NaN, false)).toBe(FLASHCARD_COUNT_DEFAULT);
    expect(clampCardCount(Infinity, true)).toBe(FLASHCARD_COUNT_DEFAULT);
    expect(clampCardCount({}, false)).toBe(FLASHCARD_COUNT_DEFAULT);
  });

  it('coerces null and empty string to zero and therefore to the minimum', () => {
    expect(clampCardCount(null, false)).toBe(FLASHCARD_COUNT_MIN);
    expect(clampCardCount('', false)).toBe(FLASHCARD_COUNT_MIN);
  });
});

describe('buildFlashcardsContextFilter', () => {
  it('hard-scopes on positive section ids only', () => {
    expect(
      buildFlashcardsContextFilter({
        sectionIds: [4, 0, -1],
        sectionNumbers: [],
        sectionName: 'ignored',
      }),
    ).toEqual({
      sectionIds: [4],
      sectionNumbers: [],
      hardSectionScope: true,
    });
  });

  it('hard-scopes on section numbers alone', () => {
    expect(buildFlashcardsContextFilter({ sectionNumbers: [2] })).toEqual({
      sectionIds: [],
      sectionNumbers: [2],
      hardSectionScope: true,
    });
  });

  it('falls back to the soft filter when nothing is scoped', () => {
    expect(
      buildFlashcardsContextFilter({
        sectionId: 8,
        sectionNumber: 2,
        sectionName: 'Week 2',
      }),
    ).toEqual({ sectionId: 8, sectionNumber: 2, sectionName: 'Week 2' });
  });
});

describe('buildFlashcardsProposalMessage', () => {
  it('states the card count, scope and confirm instructions', () => {
    const message = buildFlashcardsProposalMessage({
      title: 'Key terms',
      scopeSummary: 'Week 3 readings',
      cardCount: 15,
    });

    expect(message).toBe(
      [
        'I can create a **private flashcards** Page in Moodle for you.',
        '',
        '**Key terms**',
        '- **15 flashcards** (flip each card, then mark Got it / Missed it)',
        '- Covers: Week 3 readings',
        '- Practice aid only — not graded',
        '- Placed under **AI Content** (only you and instructors can see it)',
        '',
        'Nothing will be created until you press **Confirm**. Use **Cancel** to discard this plan.',
      ].join('\n'),
    );
  });

  it('explains the cap when the student asked for more than allowed', () => {
    const message = buildFlashcardsProposalMessage({
      title: 'Key terms',
      scopeSummary: 'Week 3',
      cardCount: 40,
      requestedCount: 60,
    });

    expect(message).toContain(
      'You asked for **60** flashcards, but I can only create decks with up to **40** cards. This plan uses 40.',
    );
  });

  it('omits the cap notice when no explicit count was requested', () => {
    const message = buildFlashcardsProposalMessage({
      title: 'Key terms',
      scopeSummary: 'Week 3',
      cardCount: 12,
    });

    expect(message).not.toContain('You asked for');
  });

  it('still shows the notice when the requested count is zero', () => {
    const message = buildFlashcardsProposalMessage({
      title: 'Key terms',
      scopeSummary: 'Week 3',
      cardCount: 8,
      requestedCount: 0,
    });

    expect(message).toContain('You asked for **0** flashcards');
  });
});

describe('normalizeFlashcardsDocument', () => {
  it('returns null for null and undefined input', () => {
    expect(normalizeFlashcardsDocument(null, 10)).toBeNull();
    expect(normalizeFlashcardsDocument(undefined, 10)).toBeNull();
  });

  it('returns null when the title is blank or missing', () => {
    expect(
      normalizeFlashcardsDocument(
        { title: '  ', cards: [{ front: 'f', back: 'b' }] },
        10,
      ),
    ).toBeNull();
    expect(
      normalizeFlashcardsDocument({ cards: [{ front: 'f', back: 'b' }] }, 10),
    ).toBeNull();
  });

  it('returns null when no card survives filtering', () => {
    expect(normalizeFlashcardsDocument({ title: 'T', cards: [] }, 10)).toBeNull();
    expect(
      normalizeFlashcardsDocument(
        { title: 'T', cards: [{ front: 'f', back: '' }, { front: '', back: 'b' }] },
        10,
      ),
    ).toBeNull();
    expect(normalizeFlashcardsDocument({ title: 'T' }, 10)).toBeNull();
  });

  it('drops half-filled cards and keeps the rest in order', () => {
    const doc = normalizeFlashcardsDocument(
      {
        title: 'Terms',
        cards: [
          { front: 'Q1', back: 'A1' },
          { front: 'Q2', back: '   ' },
          { front: 'Q3', back: 'A3' },
        ],
      },
      10,
    );

    expect(doc).toEqual({
      title: 'Terms',
      cards: [
        { front: 'Q1', back: 'A1' },
        { front: 'Q3', back: 'A3' },
      ],
    });
  });

  it('survives null card entries and coerces non-string sides', () => {
    const doc = normalizeFlashcardsDocument(
      { title: 'T', cards: [null, { front: 1, back: 2 }] } as never,
      10,
    );

    expect(doc?.cards).toEqual([{ front: '1', back: '2' }]);
  });

  it('scrubs HTML and URLs from the title and both card sides', () => {
    const doc = normalizeFlashcardsDocument(
      {
        title: '<b>Key</b> terms',
        cards: [
          {
            front: 'What is at https://evil.com/x ?',
            back: 'See [notes](https://e.com/n) instead',
          },
        ],
      },
      10,
    );

    expect(doc?.title).toBe('Key terms');
    expect(doc?.cards[0]).toEqual({
      front: 'What is at ?',
      back: 'See notes instead',
    });
  });

  it('truncates the deck to maxCards after filtering', () => {
    const doc = normalizeFlashcardsDocument(
      {
        title: 'T',
        cards: [
          { front: 'bad', back: '' },
          ...Array.from({ length: 5 }, (_, i) => ({
            front: `Q${i}`,
            back: `A${i}`,
          })),
        ],
      },
      2,
    );

    expect(doc?.cards).toEqual([
      { front: 'Q0', back: 'A0' },
      { front: 'Q1', back: 'A1' },
    ]);
  });

  it('caps the title at 200 characters', () => {
    const doc = normalizeFlashcardsDocument(
      { title: 'T'.repeat(260), cards: [{ front: 'f', back: 'b' }] },
      10,
    );

    expect(doc?.title).toHaveLength(200);
  });
});

describe('renderFlashcardsHtml', () => {
  const doc = {
    title: 'Terms',
    cards: [
      { front: 'What is a TLB?', back: 'A translation cache' },
      { front: 'What is a page fault?', back: 'A missing page trap' },
    ],
  };

  it('opens with the study wrapper and ends with the private-content footer', () => {
    const html = renderFlashcardsHtml(doc);

    expect(html.startsWith('<div class="syll-fc" data-syll-fc-study="1">\n')).toBe(
      true,
    );
    expect(
      html.endsWith(
        '<p class="syll-fc-footer"><em>Private flashcards created by Syllentras AI. This is a practice aid and is not graded.</em></p>\n</div>',
      ),
    ).toBe(true);
  });

  it('reports the deck size in the progress label', () => {
    expect(renderFlashcardsHtml(doc)).toContain(
      '<span class="syll-fc-progress" aria-live="polite">Card: 1 / 2</span>',
    );
  });

  it('emits one card block per card with index-based ids and labels', () => {
    const html = renderFlashcardsHtml(doc);

    expect(html).toContain('<div class="syll-fc-card" data-card-index="0">');
    expect(html).toContain(
      '<input type="checkbox" id="syll-fc-0" class="syll-fc-toggle" />',
    );
    expect(html).toContain('<label for="syll-fc-0" class="syll-fc-face">');
    expect(html).toContain('<span class="syll-fc-index">1 / 2</span>');
    expect(html).toContain('<div class="syll-fc-card" data-card-index="1">');
    expect(html).toContain('<label for="syll-fc-1" class="syll-fc-face">');
    expect(html).toContain('<span class="syll-fc-index">2 / 2</span>');
    expect(html.match(/class="syll-fc-card"/g)).toHaveLength(2);
  });

  it('renders card fronts as escaped plain text', () => {
    const html = renderFlashcardsHtml({
      title: 'T',
      cards: [{ front: 'A & B <script>alert("x")</script>', back: 'answer' }],
    });

    expect(html).toContain(
      '<span class="syll-fc-prompt">A &amp; B &lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;</span>',
    );
    expect(html).not.toContain('<script>');
  });

  it('renders card backs as markdown', () => {
    const html = renderFlashcardsHtml({
      title: 'T',
      cards: [{ front: 'f', back: 'A **bold** answer' }],
    });

    expect(html).toContain(
      '<span class="syll-fc-answer"><p>A <strong>bold</strong> answer</p></span>',
    );
  });

  it('falls back to escaped text when the back sanitizes away to nothing', () => {
    const html = renderFlashcardsHtml({
      title: 'T',
      cards: [{ front: 'f', back: '<script>alert(1)</script>' }],
    });

    expect(html).toContain(
      '<span class="syll-fc-answer">&lt;script&gt;alert(1)&lt;/script&gt;</span>',
    );
  });

  it('keeps the grade/restart controls and results region in the markup', () => {
    const html = renderFlashcardsHtml(doc);

    expect(html).toContain(
      '<button type="button" class="syll-fc-btn syll-fc-btn-restart">Shuffle &amp; try again</button>',
    );
    expect(html).toContain(
      '<button type="button" class="syll-fc-btn syll-fc-btn-correct">Got it</button>',
    );
    expect(html).toContain(
      '<button type="button" class="syll-fc-btn syll-fc-btn-incorrect">Missed it</button>',
    );
    expect(html).toContain('<div class="syll-fc-results" hidden>');
  });

  it('renders a single-card deck with a 1 / 1 label', () => {
    const html = renderFlashcardsHtml({
      title: 'T',
      cards: [{ front: 'only', back: 'one' }],
    });

    expect(html).toContain('Card: 1 / 1');
    expect(html.match(/class="syll-fc-card"/g)).toHaveLength(1);
  });
});
