import type { PracticeQuizQuestion } from '../../../src/context/context.types';
import {
  QUIZ_DIFFICULTIES,
  QUIZ_QUESTION_COUNT_AUTO_MAX,
  QUIZ_QUESTION_COUNT_DEFAULT,
  QUIZ_QUESTION_COUNT_EXPLICIT_MAX,
  QUIZ_QUESTION_COUNT_MIN,
  buildPracticeQuizContextFilter,
  buildProposalMessage,
  buildReviewMessage,
  containsUrl,
  clampQuestionCount,
  formatQuizDifficultyLabel,
  isMetaPracticeQuestion,
  normalizeQuestion,
  normalizeQuizDifficulty,
  questionDedupeKey,
  scrubQuizGenerationContext,
  shuffleInPlace,
  stripLinksAndHtml,
} from '../../../src/chat/practice-quiz.helpers';

/**
 * shuffleInPlace picks j = floor(random * (i + 1)) walking i from the end.
 * random === 0 always swaps with index 0; random ~1 always swaps i with itself.
 */
function forceShuffleToIndexZero(): jest.SpyInstance {
  return jest.spyOn(Math, 'random').mockReturnValue(0);
}

function forceShuffleToIdentity(): jest.SpyInstance {
  return jest.spyOn(Math, 'random').mockReturnValue(0.9999999);
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe('normalizeQuizDifficulty', () => {
  it.each(QUIZ_DIFFICULTIES)('passes through the known level %s', (level) => {
    expect(normalizeQuizDifficulty(level)).toBe(level);
  });

  it('trims and lowercases before matching', () => {
    expect(normalizeQuizDifficulty('  HARD  ')).toBe('hard');
    expect(normalizeQuizDifficulty('Expert')).toBe('expert');
  });

  it('falls back to medium for an unknown level', () => {
    expect(normalizeQuizDifficulty('impossible')).toBe('medium');
    expect(normalizeQuizDifficulty('')).toBe('medium');
  });

  it.each([[undefined], [null], [3], [{ difficulty: 'hard' }], [['hard']]])(
    'falls back to medium for the non-string %p',
    (value) => {
      expect(normalizeQuizDifficulty(value)).toBe('medium');
    },
  );
});

describe('formatQuizDifficultyLabel', () => {
  it('capitalizes the first letter only', () => {
    expect(formatQuizDifficultyLabel('easy')).toBe('Easy');
    expect(formatQuizDifficultyLabel('medium')).toBe('Medium');
    expect(formatQuizDifficultyLabel('hard')).toBe('Hard');
    expect(formatQuizDifficultyLabel('expert')).toBe('Expert');
  });
});

describe('clampQuestionCount', () => {
  it('returns the value untouched inside the auto range', () => {
    expect(clampQuestionCount(8, false)).toBe(8);
    expect(clampQuestionCount(12, false)).toBe(12);
  });

  it('clamps up to the minimum for 0, 1 and negative counts', () => {
    expect(clampQuestionCount(0, false)).toBe(QUIZ_QUESTION_COUNT_MIN);
    expect(clampQuestionCount(1, true)).toBe(QUIZ_QUESTION_COUNT_MIN);
    expect(clampQuestionCount(-40, true)).toBe(QUIZ_QUESTION_COUNT_MIN);
    expect(QUIZ_QUESTION_COUNT_MIN).toBe(5);
  });

  it('accepts exactly the minimum', () => {
    expect(clampQuestionCount(QUIZ_QUESTION_COUNT_MIN, false)).toBe(5);
  });

  it('caps AI-chosen counts at the auto maximum', () => {
    expect(clampQuestionCount(QUIZ_QUESTION_COUNT_AUTO_MAX, false)).toBe(15);
    expect(clampQuestionCount(16, false)).toBe(15);
    expect(clampQuestionCount(500, false)).toBe(15);
  });

  it('lets a student-specified count go past the auto maximum up to the explicit cap', () => {
    expect(clampQuestionCount(16, true)).toBe(16);
    expect(clampQuestionCount(QUIZ_QUESTION_COUNT_EXPLICIT_MAX, true)).toBe(40);
    expect(clampQuestionCount(41, true)).toBe(40);
    expect(clampQuestionCount(1000, true)).toBe(40);
  });

  it('rounds non-integer counts half-up', () => {
    expect(clampQuestionCount(7.4, false)).toBe(7);
    expect(clampQuestionCount(7.5, false)).toBe(8);
    expect(clampQuestionCount(7.6, false)).toBe(8);
  });

  it('coerces numeric strings', () => {
    expect(clampQuestionCount('12', false)).toBe(12);
    expect(clampQuestionCount('  9 ', true)).toBe(9);
  });

  it('returns the default for values that are not finite numbers', () => {
    expect(clampQuestionCount(undefined, false)).toBe(
      QUIZ_QUESTION_COUNT_DEFAULT,
    );
    expect(clampQuestionCount('twelve', true)).toBe(QUIZ_QUESTION_COUNT_DEFAULT);
    expect(clampQuestionCount(NaN, false)).toBe(QUIZ_QUESTION_COUNT_DEFAULT);
    expect(clampQuestionCount(Infinity, true)).toBe(QUIZ_QUESTION_COUNT_DEFAULT);
    expect(clampQuestionCount({}, false)).toBe(QUIZ_QUESTION_COUNT_DEFAULT);
    expect(QUIZ_QUESTION_COUNT_DEFAULT).toBe(10);
  });

  it('treats null and empty string as 0 rather than invalid, so they clamp to the minimum', () => {
    expect(clampQuestionCount(null, false)).toBe(QUIZ_QUESTION_COUNT_MIN);
    expect(clampQuestionCount('', false)).toBe(QUIZ_QUESTION_COUNT_MIN);
  });
});

describe('buildPracticeQuizContextFilter', () => {
  it('hard-scopes when explicit section ids are present and drops non-positive ids', () => {
    expect(
      buildPracticeQuizContextFilter({
        sectionId: 99,
        sectionName: 'Ignored',
        sectionIds: [0, -3, 7, 11],
      }),
    ).toEqual({
      sectionIds: [7, 11],
      sectionNumbers: [],
      hardSectionScope: true,
    });
  });

  it('hard-scopes on section numbers alone', () => {
    expect(
      buildPracticeQuizContextFilter({ sectionNumbers: [2, 3] }),
    ).toEqual({
      sectionIds: [],
      sectionNumbers: [2, 3],
      hardSectionScope: true,
    });
  });

  it('falls back to the soft conversation-scoped filter when nothing is hard-scoped', () => {
    expect(
      buildPracticeQuizContextFilter({
        sectionId: 42,
        sectionNumber: 3,
        sectionName: 'Week 3',
      }),
    ).toEqual({ sectionId: 42, sectionNumber: 3, sectionName: 'Week 3' });
  });

  it('falls back to the soft filter when every explicit section id is filtered out', () => {
    const filter = buildPracticeQuizContextFilter({
      sectionIds: [0, -1],
      sectionNumbers: [],
      sectionNumber: 4,
    });

    expect(filter.hardSectionScope).toBeUndefined();
    expect(filter.sectionIds).toBeUndefined();
    expect(filter.sectionNumber).toBe(4);
  });

  it('produces an empty soft filter when the payload carries no section hints', () => {
    expect(buildPracticeQuizContextFilter({})).toEqual({});
  });
});

describe('buildProposalMessage', () => {
  it('renders the full proposal without a requested-count note', () => {
    expect(
      buildProposalMessage({
        title: 'Memory Management Practice',
        questionCount: 10,
        scopeSummary: 'Week 3 — paging and segmentation',
        difficulty: 'hard',
      }),
    ).toBe(
      [
        'I can create a **private practice quiz** in Moodle for you.',
        '',
        '**Memory Management Practice**',
        '- **10 questions** (multiple choice and true/false)',
        '- Difficulty: **Hard**',
        '- Covers: Week 3 — paging and segmentation',
        '- Practice only — will **not** count toward your course grade',
        '- Placed under **AI Content** (only you and instructors can see it)',
        '',
        'Nothing will be created until you press **Confirm**. Use **Cancel** to discard this plan.',
      ].join('\n'),
    );
  });

  it('defaults the difficulty label to Medium when the difficulty is omitted', () => {
    const message = buildProposalMessage({
      title: 'T',
      questionCount: 5,
      scopeSummary: 'S',
    });

    expect(message).toContain('- Difficulty: **Medium**');
  });

  it('explains the cap when the student asked for more than the explicit maximum', () => {
    const message = buildProposalMessage({
      title: 'T',
      questionCount: 40,
      scopeSummary: 'S',
      requestedCount: 60,
    });

    expect(message).toContain(
      'You asked for **60** questions, but I can only create quizzes with up to **40** questions. This plan uses 40.',
    );
    expect(message.endsWith('Use **Cancel** to discard this plan.')).toBe(true);
  });

  it('omits the cap note when requestedCount is absent', () => {
    const message = buildProposalMessage({
      title: 'T',
      questionCount: 10,
      scopeSummary: 'S',
    });

    expect(message).not.toContain('You asked for');
  });

  it('still shows the cap note when the requested count is 0 (present but falsy)', () => {
    const message = buildProposalMessage({
      title: 'T',
      questionCount: 5,
      scopeSummary: 'S',
      requestedCount: 0,
    });

    expect(message).toContain('You asked for **0** questions');
  });
});

describe('buildReviewMessage', () => {
  it('renders the header and a fully escaped, linked review block', () => {
    expect(
      buildReviewMessage({
        title: 'Quiz A',
        score: 2,
        maxScore: 5,
        blocks: [
          {
            slot: 3,
            question: 'What is 2<3?',
            studentAnswer: "a'b",
            rightAnswer: 'true & false',
            why: 'Because',
            citationTitle: 'Notes',
            citationUrl: 'https://x.test/a?b=1&c=2',
            citationSnippet: 'snip',
          },
        ],
      }),
    ).toBe(
      [
        '### Practice quiz review — Quiz A',
        '**Score:** 2/5 · Walking through **1** wrong answer(s)',
        '',
        '<details class="syllentras-review-item">',
        '<summary class="syllentras-review-summary"><strong>3. ❌ What is 2&lt;3?</strong></summary>',
        '<div class="syllentras-review-body">',
        '<p>You answered: <em>a&#39;b</em></p>',
        '<p>Correct: <em>true &amp; false</em></p>',
        '<p><strong>Why:</strong> Because</p>',
        '<p><strong>From your course:</strong> <a href="https://x.test/a?b=1&amp;c=2">Notes</a></p>',
        '<blockquote>snip</blockquote>',
        '</div>',
        '</details>',
      ].join('\n'),
    );
  });

  it('omits the blockquote when there is no citation snippet', () => {
    const message = buildReviewMessage({
      title: 'Quiz A',
      score: 1,
      maxScore: 4,
      blocks: [
        {
          slot: 1,
          question: 'Q',
          studentAnswer: 'A',
          rightAnswer: 'B',
          why: 'W',
          citationTitle: 'Notes',
        },
      ],
    });

    expect(message).not.toContain('<blockquote>');
    expect(message).toContain(
      '<p><strong>From your course:</strong> Notes</p>',
    );
  });

  it('renders the citation as plain text for a non-http(s) url', () => {
    const message = buildReviewMessage({
      title: 'Quiz A',
      score: 0,
      maxScore: 1,
      blocks: [
        {
          slot: 1,
          question: 'Q',
          studentAnswer: 'A',
          rightAnswer: 'B',
          why: 'W',
          citationTitle: 'Notes',
          citationUrl: 'javascript:alert(1)',
        },
      ],
    });

    expect(message).not.toContain('<a href=');
    expect(message).toContain(
      '<p><strong>From your course:</strong> Notes</p>',
    );
  });

  it('renders the citation as plain text when the url is unparseable', () => {
    const message = buildReviewMessage({
      title: 'Quiz A',
      score: 0,
      maxScore: 1,
      blocks: [
        {
          slot: 1,
          question: 'Q',
          studentAnswer: 'A',
          rightAnswer: 'B',
          why: 'W',
          citationTitle: 'Notes',
          citationUrl: 'not a url',
        },
      ],
    });

    expect(message).not.toContain('<a href=');
  });

  it('escapes a citation title that contains markup', () => {
    const message = buildReviewMessage({
      title: 'Quiz A',
      score: 0,
      maxScore: 1,
      blocks: [
        {
          slot: 1,
          question: 'Q',
          studentAnswer: 'A',
          rightAnswer: 'B',
          why: 'W',
          citationTitle: '<script>x</script>',
          citationUrl: 'http://ok.test/p',
        },
      ],
    });

    expect(message).toContain(
      '<a href="http://ok.test/p">&lt;script&gt;x&lt;/script&gt;</a>',
    );
  });

  it('counts every block in the header and emits one details element per block', () => {
    const message = buildReviewMessage({
      title: 'Quiz A',
      score: 1,
      maxScore: 3,
      blocks: [1, 2, 3].map((slot) => ({
        slot,
        question: `Q${slot}`,
        studentAnswer: 'A',
        rightAnswer: 'B',
        why: 'W',
        citationTitle: 'Notes',
      })),
    });

    expect(message).toContain(
      '**Score:** 1/3 · Walking through **3** wrong answer(s)',
    );
    expect(message.match(/<details /g)).toHaveLength(3);
    expect(message).toContain('<strong>2. ❌ Q2</strong>');
  });

  it('returns only the trimmed header when there are no blocks', () => {
    expect(
      buildReviewMessage({
        title: 'Quiz A',
        score: 5,
        maxScore: 5,
        blocks: [],
      }),
    ).toBe(
      '### Practice quiz review — Quiz A\n' +
        '**Score:** 5/5 · Walking through **0** wrong answer(s)',
    );
  });
});

describe('scrubQuizGenerationContext', () => {
  it('removes source= markers, bare urls and collapses the resulting whitespace', () => {
    expect(
      scrubQuizGenerationContext(
        'Notes; source=https://example.com/a\nMore https://b.test/x text\n\n\n\nEnd',
      ),
    ).toBe('Notes\nMore text\n\nEnd');
  });

  it('removes a source= marker at the very start of the material', () => {
    expect(scrubQuizGenerationContext('source=http://a.test/z\nBody')).toBe(
      'Body',
    );
  });

  it('leaves url-free material untouched apart from trimming', () => {
    expect(scrubQuizGenerationContext('  Paging is a memory scheme.  ')).toBe(
      'Paging is a memory scheme.',
    );
  });

  it('collapses runs of two or more spaces or tabs into one space', () => {
    expect(scrubQuizGenerationContext('a\t\tb    c')).toBe('a b c');
  });
});

describe('stripLinksAndHtml', () => {
  it('unwraps markdown links, anchors and tags and drops bare urls', () => {
    expect(
      stripLinksAndHtml(
        'See [Docs](https://x.test/a) and <a href="https://y.test">Y</a> and <b>bold</b> https://z.test/q www.foo.com',
      ),
    ).toBe('See Docs and Y and bold');
  });

  it('unwraps mailto markdown links', () => {
    expect(stripLinksAndHtml('Email [staff](mailto:a@b.test) today')).toBe(
      'Email staff today',
    );
  });

  it('returns an empty string when the input is only markup', () => {
    expect(stripLinksAndHtml('<span></span>')).toBe('');
  });

  it('leaves plain prose unchanged', () => {
    expect(stripLinksAndHtml('A page table maps pages to frames.')).toBe(
      'A page table maps pages to frames.',
    );
  });
});

describe('containsUrl', () => {
  it.each([
    ['https://a.test', true],
    ['HTTP://A.TEST', true],
    ['see www.a.test now', true],
    ['a plain sentence', false],
    ['', false],
    ['ftp://a.test', false],
  ])('containsUrl(%p) === %p', (text, expected) => {
    expect(containsUrl(text as string)).toBe(expected);
  });
});

describe('isMetaPracticeQuestion', () => {
  it.each([
    ['Which week covered paging?', 'Q'],
    ['What is paging?', 'Final exam topics'],
    ['Is this worth 10 points?', 'Q'],
    ['The midterm covers this', 'Q'],
    ['How is grading handled?', 'Q'],
    ['According to the course outline, what is next?', 'Q'],
    ['Is it in the syllabus?', 'Q'],
    ['Does the exam include a written response?', 'Q'],
    ['What is the exam format?', 'Q'],
    ['Week 2 focuses on what?', 'Q'],
  ])('flags the meta question %p / %p', (questiontext, name) => {
    expect(isMetaPracticeQuestion(questiontext, name)).toBe(true);
  });

  it.each([
    ['What does a page table map?', 'Paging'],
    ['Compare a mutex and a semaphore.', 'Concurrency'],
    ['', ''],
  ])('does not flag the concept question %p / %p', (questiontext, name) => {
    expect(isMetaPracticeQuestion(questiontext, name)).toBe(false);
  });
});

describe('questionDedupeKey', () => {
  it('lowercases, collapses all whitespace and trims', () => {
    expect(questionDedupeKey('  What   IS\nPaging? ')).toBe('what is paging?');
  });

  it('produces the same key for two cosmetically different phrasings', () => {
    expect(questionDedupeKey('What is\tpaging?')).toBe(
      questionDedupeKey('WHAT IS PAGING?'),
    );
  });

  it('distinguishes genuinely different text', () => {
    expect(questionDedupeKey('What is paging?')).not.toBe(
      questionDedupeKey('What is swapping?'),
    );
  });
});

describe('shuffleInPlace', () => {
  it('mutates and returns the same array instance', () => {
    const items = ['a', 'b', 'c'];
    expect(shuffleInPlace(items)).toBe(items);
  });

  it('produces the expected permutation when every draw picks index 0', () => {
    forceShuffleToIndexZero();
    expect(shuffleInPlace(['a', 'b', 'c', 'd'])).toEqual([
      'b',
      'c',
      'd',
      'a',
    ]);
  });

  it('leaves the order untouched when every draw picks the current index', () => {
    forceShuffleToIdentity();
    expect(shuffleInPlace(['a', 'b', 'c', 'd'])).toEqual([
      'a',
      'b',
      'c',
      'd',
    ]);
  });

  it('preserves every element regardless of the draw', () => {
    const shuffled = shuffleInPlace([1, 2, 3, 4, 5, 6, 7, 8]);
    expect([...shuffled].sort((a, b) => a - b)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8,
    ]);
  });

  it('handles empty and single-element arrays', () => {
    expect(shuffleInPlace([])).toEqual([]);
    expect(shuffleInPlace(['only'])).toEqual(['only']);
  });
});

describe('normalizeQuestion', () => {
  function multichoice(
    overrides: Partial<PracticeQuizQuestion> = {},
  ): PracticeQuizQuestion {
    return {
      type: 'multichoice',
      name: 'Paging basics',
      questiontext: 'What does a page table map?',
      answers: [
        { text: 'Virtual pages to physical frames', fraction: 1 },
        { text: 'Files to directories', fraction: 0 },
        { text: 'Threads to cores', fraction: 0 },
      ],
      ...overrides,
    };
  }

  function truefalse(
    overrides: Partial<PracticeQuizQuestion> = {},
  ): PracticeQuizQuestion {
    return {
      type: 'truefalse',
      name: 'Paging',
      questiontext: 'A page table maps virtual pages to physical frames.',
      answers: [
        { text: 'True', fraction: 1 },
        { text: 'False', fraction: 0 },
      ],
      ...overrides,
    };
  }

  it('returns a fully normalized multichoice question', () => {
    forceShuffleToIdentity();

    expect(normalizeQuestion(multichoice())).toEqual({
      type: 'multichoice',
      name: 'Paging basics',
      questiontext: 'What does a page table map?',
      answers: [
        { text: 'Virtual pages to physical frames', fraction: 1 },
        { text: 'Files to directories', fraction: 0 },
        { text: 'Threads to cores', fraction: 0 },
      ],
    });
  });

  it('shuffles multichoice answers', () => {
    forceShuffleToIndexZero();

    expect(normalizeQuestion(multichoice())?.answers).toEqual([
      { text: 'Files to directories', fraction: 0 },
      { text: 'Threads to cores', fraction: 0 },
      { text: 'Virtual pages to physical frames', fraction: 1 },
    ]);
  });

  it('does not shuffle truefalse answers', () => {
    forceShuffleToIndexZero();

    expect(normalizeQuestion(truefalse())?.answers).toEqual([
      { text: 'True', fraction: 1 },
      { text: 'False', fraction: 0 },
    ]);
  });

  it.each([[null], [undefined]])('rejects the falsy question %p', (q) => {
    expect(normalizeQuestion(q as never)).toBeNull();
  });

  it('rejects an unsupported question type', () => {
    expect(
      normalizeQuestion(multichoice({ type: 'shortanswer' as never })),
    ).toBeNull();
  });

  it.each([[''], ['   '], ['<span></span>'], [undefined]])(
    'rejects a question whose text strips to nothing (%p)',
    (questiontext) => {
      expect(
        normalizeQuestion(multichoice({ questiontext: questiontext as never })),
      ).toBeNull();
    },
  );

  it('rejects a question whose text still contains a url after stripping', () => {
    expect(
      normalizeQuestion(
        multichoice({ questiontext: 'Check http:// for the answer' }),
      ),
    ).toBeNull();
  });

  it('rejects a question whose name still contains a url after stripping', () => {
    expect(
      normalizeQuestion(multichoice({ name: 'Visit www. now' })),
    ).toBeNull();
  });

  it('strips a markdown link out of the question text instead of rejecting it', () => {
    forceShuffleToIdentity();

    expect(
      normalizeQuestion(
        multichoice({
          questiontext: 'What does [the page table](https://x.test/pt) map?',
        }),
      )?.questiontext,
    ).toBe('What does the page table map?');
  });

  it('rejects a meta question about course logistics', () => {
    expect(
      normalizeQuestion(
        multichoice({ questiontext: 'Which week covers paging?' }),
      ),
    ).toBeNull();
  });

  it('rejects a question whose name is meta even when the text is fine', () => {
    expect(
      normalizeQuestion(multichoice({ name: 'Final exam topics' })),
    ).toBeNull();
  });

  it('rejects an answer that still contains a url after stripping', () => {
    expect(
      normalizeQuestion(
        multichoice({
          answers: [
            { text: 'Visit www. for details', fraction: 1 },
            { text: 'Files to directories', fraction: 0 },
          ],
        }),
      ),
    ).toBeNull();
  });

  it('rejects a multichoice question with fewer than two usable answers', () => {
    forceShuffleToIdentity();

    expect(
      normalizeQuestion(
        multichoice({ answers: [{ text: 'Only option', fraction: 1 }] }),
      ),
    ).toBeNull();
    expect(normalizeQuestion(multichoice({ answers: [] }))).toBeNull();
    expect(
      normalizeQuestion(multichoice({ answers: undefined as never })),
    ).toBeNull();
  });

  it('rejects a multichoice question with no correct answer', () => {
    expect(
      normalizeQuestion(
        multichoice({
          answers: [
            { text: 'Wrong A', fraction: 0 },
            { text: 'Wrong B', fraction: 0 },
          ],
        }),
      ),
    ).toBeNull();
  });

  it('rejects a multichoice question that only reaches two answers after empty ones are dropped', () => {
    forceShuffleToIdentity();

    expect(
      normalizeQuestion(
        multichoice({
          answers: [
            { text: 'Right', fraction: 1 },
            { text: '   ', fraction: 0 },
          ],
        }),
      ),
    ).toBeNull();
  });

  it('keeps duplicate multichoice answer texts rather than de-duplicating them', () => {
    forceShuffleToIdentity();

    expect(
      normalizeQuestion(
        multichoice({
          answers: [
            { text: 'Same', fraction: 1 },
            { text: 'Same', fraction: 0 },
            { text: 'Other', fraction: 0 },
          ],
        }),
      )?.answers,
    ).toEqual([
      { text: 'Same', fraction: 1 },
      { text: 'Same', fraction: 0 },
      { text: 'Other', fraction: 0 },
    ]);
  });

  it('accepts multiple correct multichoice answers', () => {
    forceShuffleToIdentity();

    expect(
      normalizeQuestion(
        multichoice({
          answers: [
            { text: 'Right A', fraction: 1 },
            { text: 'Right B', fraction: 1 },
            { text: 'Wrong', fraction: 0 },
          ],
        }),
      )?.answers,
    ).toEqual([
      { text: 'Right A', fraction: 1 },
      { text: 'Right B', fraction: 1 },
      { text: 'Wrong', fraction: 0 },
    ]);
  });

  it.each([
    [1, 1],
    [0.25, 1],
    ['0.5', 1],
    [0, 0],
    [-1, 0],
    [null, 0],
    [undefined, 0],
    ['not a number', 0],
  ])('collapses the raw fraction %p to %p', (raw, expected) => {
    forceShuffleToIdentity();

    const result = normalizeQuestion(
      truefalse({
        answers: [
          { text: 'True', fraction: raw as never },
          { text: 'False', fraction: 0 },
        ],
      }),
    );

    expect(result?.answers[0]).toEqual({ text: 'True', fraction: expected });
  });

  it.each([
    ['missing False', [{ text: 'True', fraction: 1 }]],
    ['missing True', [{ text: 'False', fraction: 1 }]],
    [
      'neither True nor False',
      [
        { text: 'Yes', fraction: 1 },
        { text: 'No', fraction: 0 },
      ],
    ],
    ['no answers at all', []],
  ])('rejects a truefalse question %s', (_label, answers) => {
    expect(
      normalizeQuestion(truefalse({ answers: answers as never })),
    ).toBeNull();
  });

  it('matches True/False case-insensitively and with surrounding whitespace', () => {
    expect(
      normalizeQuestion(
        truefalse({
          answers: [
            { text: ' TRUE ', fraction: 0 },
            { text: 'false', fraction: 1 },
          ],
        }),
      )?.answers,
    ).toEqual([
      { text: 'TRUE', fraction: 0 },
      { text: 'false', fraction: 1 },
    ]);
  });

  it('accepts a truefalse question with no correct answer marked', () => {
    expect(
      normalizeQuestion(
        truefalse({
          answers: [
            { text: 'True', fraction: 0 },
            { text: 'False', fraction: 0 },
          ],
        }),
      )?.answers,
    ).toEqual([
      { text: 'True', fraction: 0 },
      { text: 'False', fraction: 0 },
    ]);
  });

  it('drops empty answers before the truefalse shape check', () => {
    expect(
      normalizeQuestion(
        truefalse({
          answers: [
            { text: 'True', fraction: 1 },
            { text: '  ', fraction: 0 },
            { text: 'False', fraction: 0 },
          ],
        }),
      )?.answers,
    ).toEqual([
      { text: 'True', fraction: 1 },
      { text: 'False', fraction: 0 },
    ]);
  });

  it('truncates the name to 200 characters', () => {
    forceShuffleToIdentity();

    const result = normalizeQuestion(multichoice({ name: 'A'.repeat(250) }));

    expect(result?.name).toHaveLength(200);
    expect(result?.name).toBe('A'.repeat(200));
  });

  it('falls back to "Practice question" when the name is empty', () => {
    forceShuffleToIdentity();

    expect(normalizeQuestion(multichoice({ name: '' }))?.name).toBe(
      'Practice question',
    );
  });

  it('falls back to "Practice question" when the name strips down to nothing', () => {
    forceShuffleToIdentity();

    expect(normalizeQuestion(multichoice({ name: '<span></span>' }))?.name).toBe(
      'Practice question',
    );
  });

  it('drops an answer whose text is missing rather than stringifying it', () => {
    expect(
      normalizeQuestion(
        truefalse({
          answers: [
            { text: 'True', fraction: 1 },
            { text: undefined as never, fraction: 0 },
            { text: null as never, fraction: 0 },
            { text: 'False', fraction: 0 },
          ],
        }),
      )?.answers,
    ).toEqual([
      { text: 'True', fraction: 1 },
      { text: 'False', fraction: 0 },
    ]);
  });

  it('coerces non-string answer text', () => {
    expect(
      normalizeQuestion(
        truefalse({
          answers: [
            { text: 'True', fraction: 1 },
            { text: 'False', fraction: 0 },
            { text: 42 as never, fraction: 0 },
          ],
        }),
      )?.answers,
    ).toEqual([
      { text: 'True', fraction: 1 },
      { text: 'False', fraction: 0 },
      { text: '42', fraction: 0 },
    ]);
  });

  it('does not carry over unexpected extra properties from the raw question', () => {
    forceShuffleToIdentity();

    const result = normalizeQuestion(
      multichoice({ extra: 'nope' } as never) as PracticeQuizQuestion,
    );

    expect(Object.keys(result as object).sort()).toEqual([
      'answers',
      'name',
      'questiontext',
      'type',
    ]);
  });
});
