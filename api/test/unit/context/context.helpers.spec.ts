jest.mock('pdf-parse', () => ({
  PDFParse: jest.fn(),
}));

import {
  extractSectionIndexNumbers,
  extractWeekNumbers,
  formatCitationTitle,
  formatDocumentsForPrompt,
  matchesSection,
  pickBestDocument,
  scopeIncludesSectionName,
  sectionNameMatchesWeekNumbers,
  uniqueCourseSections,
} from '../../../src/context/context.helpers';
import type {
  CourseContextDocument,
  CourseContextFilter,
} from '../../../src/context/context.types';

function doc(
  overrides: Partial<CourseContextDocument> &
    Pick<CourseContextDocument, 'contentType' | 'text'>,
): CourseContextDocument {
  return { courseId: 12, ...overrides };
}

describe('extractWeekNumbers', () => {
  it('extracts a single week number from singular and plural forms', () => {
    expect([...extractWeekNumbers('quiz me on week 3')]).toEqual([3]);
    expect([...extractWeekNumbers('quiz me on weeks 3')]).toEqual([3]);
  });

  it('is case-insensitive', () => {
    expect([...extractWeekNumbers('WEEK 7 review')]).toEqual([7]);
    expect([...extractWeekNumbers('Week 7 review')]).toEqual([7]);
  });

  it('expands hyphen ranges inclusively', () => {
    expect([...extractWeekNumbers('weeks 1-3')]).toEqual([1, 2, 3]);
  });

  it('expands ranges written with spaces, en dash, and em dash', () => {
    expect([...extractWeekNumbers('weeks 1 - 2')]).toEqual([1, 2]);
    expect([...extractWeekNumbers('weeks 1\u20133')]).toEqual([1, 2, 3]);
    expect([...extractWeekNumbers('weeks 2\u20143')]).toEqual([2, 3]);
  });

  it("expands 'N to M' ranges", () => {
    expect([...extractWeekNumbers('weeks 2 to 4')]).toEqual([2, 3, 4]);
  });

  it('normalizes reversed ranges low-to-high', () => {
    expect([...extractWeekNumbers('weeks 5-3')]).toEqual([3, 4, 5]);
  });

  it('collects every week mentioned, including a range plus a single week', () => {
    expect([...extractWeekNumbers('weeks 1-2 and also week 5')].sort()).toEqual([
      1, 2, 5,
    ]);
    expect(
      [...extractWeekNumbers('review week 1 and week 4 material')].sort(),
    ).toEqual([1, 4]);
  });

  it('requires whitespace between the keyword and the number', () => {
    expect([...extractWeekNumbers('week3 notes')]).toEqual([]);
  });

  it('ignores section references and returns an empty set for no match', () => {
    expect(extractWeekNumbers('section 3').size).toBe(0);
    expect(extractWeekNumbers('general photosynthesis review').size).toBe(0);
  });

  it('returns an empty set for an empty scope', () => {
    expect(extractWeekNumbers('').size).toBe(0);
  });

  it('skips a range whose bound overflows to Infinity instead of expanding it', () => {
    // Without the finiteness guard this range would loop forever.
    expect([...extractWeekNumbers(`weeks 1-${'9'.repeat(400)}`)]).toEqual([1]);
  });

  it('skips a single week number that overflows to Infinity', () => {
    expect([...extractWeekNumbers(`week ${'9'.repeat(400)}`)]).toEqual([]);
  });
});

describe('extractSectionIndexNumbers', () => {
  it('extracts singular and plural section indexes, including zero', () => {
    expect([...extractSectionIndexNumbers('cover section 4')]).toEqual([4]);
    expect([...extractSectionIndexNumbers('cover sections 4')]).toEqual([4]);
    expect([...extractSectionIndexNumbers('the general section 0')]).toEqual([
      0,
    ]);
  });

  it('expands hyphen and "to" ranges', () => {
    expect([...extractSectionIndexNumbers('sections 2-3')]).toEqual([2, 3]);
    expect([...extractSectionIndexNumbers('sections 1 to 3')]).toEqual([
      1, 2, 3,
    ]);
  });

  it('ignores week references', () => {
    expect(extractSectionIndexNumbers('week 2').size).toBe(0);
    expect(extractSectionIndexNumbers('weeks 2-4').size).toBe(0);
  });

  it('requires whitespace between the keyword and the number', () => {
    expect([...extractSectionIndexNumbers('section4')]).toEqual([]);
  });
});

describe('sectionNameMatchesWeekNumbers', () => {
  it('matches "Week N" inside a longer section name', () => {
    expect(
      sectionNameMatchesWeekNumbers('Week 3: Genetics', new Set([3])),
    ).toBe(true);
  });

  it('matches zero-padded week numbers', () => {
    expect(sectionNameMatchesWeekNumbers('Week 03 - Cells', new Set([3]))).toBe(
      true,
    );
  });

  it('matches the short "WN" form with or without a space', () => {
    expect(sectionNameMatchesWeekNumbers('W3 Recap', new Set([3]))).toBe(true);
    expect(sectionNameMatchesWeekNumbers('Lab w 3', new Set([3]))).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(sectionNameMatchesWeekNumbers('WEEK 2', new Set([2]))).toBe(true);
    expect(sectionNameMatchesWeekNumbers('week 2', new Set([2]))).toBe(true);
  });

  it('does not match a longer number that merely starts with the week number', () => {
    expect(
      sectionNameMatchesWeekNumbers('Week 30 Wrap-up', new Set([3])),
    ).toBe(false);
  });

  it('matches when any number in the set matches', () => {
    expect(
      sectionNameMatchesWeekNumbers('Week 2 Wrap', new Set([5, 2])),
    ).toBe(true);
  });

  it('returns false for an unnamed section or an empty number set', () => {
    expect(sectionNameMatchesWeekNumbers(undefined, new Set([1]))).toBe(false);
    expect(sectionNameMatchesWeekNumbers('', new Set([1]))).toBe(false);
    expect(sectionNameMatchesWeekNumbers('Week 1', new Set())).toBe(false);
  });

  it('returns false for a section name without any week marker', () => {
    expect(
      sectionNameMatchesWeekNumbers('Photosynthesis', new Set([1])),
    ).toBe(false);
  });
});

describe('scopeIncludesSectionName', () => {
  it('matches a section name of exactly four characters', () => {
    expect(scopeIncludesSectionName('review labs before exam', 'Labs')).toBe(
      true,
    );
  });

  it('rejects section names shorter than four characters after trimming', () => {
    expect(scopeIncludesSectionName('review lab before exam', 'Lab')).toBe(
      false,
    );
    expect(scopeIncludesSectionName('week 1 quiz', 'W1  ')).toBe(false);
  });

  it('trims the section name and compares case-insensitively', () => {
    expect(
      scopeIncludesSectionName('quiz on Cell Biology please', '  cell biology '),
    ).toBe(true);
    expect(
      scopeIncludesSectionName('quiz on CELL BIOLOGY please', 'Cell Biology'),
    ).toBe(true);
  });

  it('requires the whole section name to appear in the scope', () => {
    expect(
      scopeIncludesSectionName(
        'Review photosynthesis basics',
        'Photosynthesis Intro',
      ),
    ).toBe(false);
  });
});

describe('matchesSection (plural filters)', () => {
  const target = doc({
    sectionId: 100,
    sectionNumber: 2,
    sectionName: 'Week Two',
    contentType: 'section_summary',
    text: 'content',
  });

  it('matches when sectionIds contains the document section id', () => {
    expect(matchesSection(target, { sectionIds: [99, 100] })).toBe(true);
  });

  it('matches via sectionNumbers when sectionIds does not contain the id', () => {
    expect(
      matchesSection(target, { sectionIds: [1, 2], sectionNumbers: [2] }),
    ).toBe(true);
  });

  it('matches sectionNumber 0 through sectionNumbers', () => {
    const general = doc({
      sectionId: 90,
      sectionNumber: 0,
      contentType: 'section_summary',
      text: 'general',
    });
    expect(matchesSection(general, { sectionNumbers: [0] })).toBe(true);
  });

  it('ignores empty plural arrays', () => {
    expect(matchesSection(target, { sectionIds: [], sectionNumbers: [] })).toBe(
      false,
    );
  });

  it('falls through to the singular filters when plural arrays do not match', () => {
    expect(matchesSection(target, { sectionIds: [7], sectionId: 100 })).toBe(
      true,
    );
    expect(
      matchesSection(target, { sectionNumbers: [7], sectionName: 'week two' }),
    ).toBe(true);
  });

  it('does not match a document with no section id against sectionIds', () => {
    const unsectioned = doc({
      sectionNumber: 2,
      contentType: 'course_summary',
      text: 'no section id',
    });
    expect(matchesSection(unsectioned, { sectionIds: [100] })).toBe(false);
  });
});

describe('uniqueCourseSections', () => {
  it('returns one entry per section id in first-seen order', () => {
    const documents = [
      doc({
        sectionId: 5,
        sectionNumber: 2,
        sectionName: 'Week 2',
        contentType: 'section_summary',
        text: 'a',
      }),
      doc({
        sectionId: 5,
        sectionNumber: 2,
        sectionName: 'Week 2 (renamed later)',
        contentType: 'page',
        text: 'b',
      }),
      doc({
        sectionId: 4,
        sectionNumber: 1,
        sectionName: 'Week 1',
        contentType: 'page',
        text: 'c',
      }),
    ];

    expect(uniqueCourseSections(documents)).toEqual([
      { sectionId: 5, sectionNumber: 2, sectionName: 'Week 2' },
      { sectionId: 4, sectionNumber: 1, sectionName: 'Week 1' },
    ]);
  });

  it('keeps section id 0 / section number 0 and documents without a name', () => {
    const documents = [
      doc({
        sectionId: 0,
        sectionNumber: 0,
        sectionName: 'General',
        contentType: 'section_summary',
        text: 'general',
      }),
      doc({
        sectionId: 6,
        sectionNumber: 3,
        contentType: 'page',
        text: 'unnamed section',
      }),
    ];

    expect(uniqueCourseSections(documents)).toEqual([
      { sectionId: 0, sectionNumber: 0, sectionName: 'General' },
      { sectionId: 6, sectionNumber: 3, sectionName: undefined },
    ]);
  });

  it('skips documents missing either the section id or the section number', () => {
    const documents = [
      doc({ sectionNumber: 3, contentType: 'course_summary', text: 'no id' }),
      doc({ sectionId: 7, contentType: 'page', text: 'no number' }),
    ];

    expect(uniqueCourseSections(documents)).toEqual([]);
  });

  it('returns an empty array for no documents', () => {
    expect(uniqueCourseSections([])).toEqual([]);
  });
});

describe('formatCitationTitle', () => {
  it('joins section and resource with an em dash when they differ', () => {
    expect(
      formatCitationTitle(
        doc({
          sectionName: 'Week 1',
          moduleName: 'Lecture Notes',
          contentType: 'page',
          text: 'x',
        }),
      ),
    ).toBe('Week 1 \u2014 Lecture Notes');
  });

  it('falls back to the file name as the resource', () => {
    expect(
      formatCitationTitle(
        doc({
          sectionName: 'Week 1',
          fileName: 'notes.pdf',
          contentType: 'resource_pdf',
          text: 'x',
        }),
      ),
    ).toBe('Week 1 \u2014 notes.pdf');
  });

  it('prefers the module name over the file name', () => {
    expect(
      formatCitationTitle(
        doc({
          sectionName: 'Week 1',
          moduleName: 'Slides',
          fileName: 'notes.pdf',
          contentType: 'resource_pdf',
          text: 'x',
        }),
      ),
    ).toBe('Week 1 \u2014 Slides');
  });

  it('returns only the section when the resource name is the same ignoring case', () => {
    expect(
      formatCitationTitle(
        doc({
          sectionName: 'Week 1',
          moduleName: 'week 1',
          contentType: 'page',
          text: 'x',
        }),
      ),
    ).toBe('Week 1');
  });

  it('returns the section alone when there is no resource', () => {
    expect(
      formatCitationTitle(
        doc({ sectionName: '  Week 1  ', contentType: 'page', text: 'x' }),
      ),
    ).toBe('Week 1');
  });

  it('returns the resource alone when there is no section', () => {
    expect(
      formatCitationTitle(
        doc({ moduleName: '  Syllabus  ', contentType: 'page', text: 'x' }),
      ),
    ).toBe('Syllabus');
  });

  it("falls back to 'Course material' when nothing is named", () => {
    expect(
      formatCitationTitle(doc({ contentType: 'course_summary', text: 'x' })),
    ).toBe('Course material');
    expect(
      formatCitationTitle(
        doc({
          sectionName: '   ',
          moduleName: '   ',
          fileName: '   ',
          contentType: 'course_summary',
          text: 'x',
        }),
      ),
    ).toBe('Course material');
  });
});

describe('pickBestDocument', () => {
  const week1Low = doc({
    sectionId: 100,
    sectionNumber: 1,
    sectionName: 'Week 1',
    contentType: 'week1_low',
    text: 'a short intro',
  });
  const week2High = doc({
    sectionId: 101,
    sectionNumber: 2,
    sectionName: 'Week 2',
    contentType: 'week2_high',
    text: 'covalent bonding electrons orbitals explained',
  });

  it('returns null for an empty document list', () => {
    expect(pickBestDocument([], {}, 'anything')).toBeNull();
  });

  it('returns the most relevant document when no filter is supplied', () => {
    expect(
      pickBestDocument(
        [week1Low, week2High],
        {},
        'explain covalent bonding of electrons',
      ),
    ).toBe(week2High);
  });

  it('prefers an in-section document over a more relevant out-of-section one', () => {
    expect(
      pickBestDocument(
        [week2High, week1Low],
        { sectionNumber: 1 },
        'explain covalent bonding of electrons',
      ),
    ).toBe(week1Low);
  });

  it('returns null under a hard section scope with no in-scope documents', () => {
    expect(
      pickBestDocument(
        [week1Low, week2High],
        { sectionNumbers: [9], hardSectionScope: true },
        'explain covalent bonding of electrons',
      ),
    ).toBeNull();
  });
});

describe('formatDocumentsForPrompt hard section scope', () => {
  function corpus(): CourseContextDocument[] {
    return [
      doc({
        sectionId: 100,
        sectionNumber: 1,
        sectionName: 'Week 1',
        contentType: 'in_scope',
        text: 'week one basics',
      }),
      doc({
        sectionId: 101,
        sectionNumber: 2,
        sectionName: 'Week 2',
        contentType: 'out_of_scope',
        text: 'mitosis chromosomes anaphase detailed notes',
      }),
    ];
  }

  function contentTypes(prompt: string): string[] {
    return prompt
      .split('\n')
      .filter((line) => line.startsWith('Metadata: type='))
      .map((line) => line.replace('Metadata: type=', '').split(';')[0]);
  }

  it('drops out-of-scope documents entirely for a hard sectionNumber scope', () => {
    const prompt = formatDocumentsForPrompt(
      corpus(),
      { sectionNumber: 1, hardSectionScope: true },
      'what happens during mitosis and anaphase',
    );

    expect(contentTypes(prompt)).toEqual(['in_scope']);
    expect(prompt).not.toContain('Week 2');
    expect(prompt).not.toContain('mitosis chromosomes anaphase detailed notes');
  });

  it('keeps out-of-scope documents when the same scope is soft', () => {
    const prompt = formatDocumentsForPrompt(
      corpus(),
      { sectionNumber: 1 },
      'what happens during mitosis and anaphase',
    );

    expect(contentTypes(prompt)).toEqual(['in_scope', 'out_of_scope']);
  });

  it('honours a hard scope expressed as sectionIds, sectionName, or sectionNumber 0', () => {
    expect(
      contentTypes(
        formatDocumentsForPrompt(
          corpus(),
          { sectionIds: [101], hardSectionScope: true },
          'week one basics',
        ),
      ),
    ).toEqual(['out_of_scope']);

    expect(
      contentTypes(
        formatDocumentsForPrompt(
          corpus(),
          { sectionName: 'week 1', hardSectionScope: true },
          'mitosis',
        ),
      ),
    ).toEqual(['in_scope']);

    const withGeneral = [
      ...corpus(),
      doc({
        sectionId: 99,
        sectionNumber: 0,
        sectionName: 'General',
        contentType: 'general',
        text: 'course wide notice',
      }),
    ];
    expect(
      contentTypes(
        formatDocumentsForPrompt(
          withGeneral,
          { sectionNumber: 0, hardSectionScope: true },
          'notice',
        ),
      ),
    ).toEqual(['general']);
  });

  it('returns an empty prompt when a hard scope matches nothing', () => {
    expect(
      formatDocumentsForPrompt(
        corpus(),
        { sectionIds: [999], hardSectionScope: true },
        'anything',
      ),
    ).toBe('');
  });

  it('ignores hardSectionScope when the filter carries no section constraint', () => {
    const emptyPluralFilter: CourseContextFilter = {
      sectionIds: [],
      sectionNumbers: [],
      hardSectionScope: true,
    };

    expect(contentTypes(formatDocumentsForPrompt(corpus(), emptyPluralFilter, 'mitosis chromosomes')))
      .toEqual(['out_of_scope', 'in_scope']);
    expect(
      contentTypes(
        formatDocumentsForPrompt(
          corpus(),
          { hardSectionScope: true },
          'week one basics',
        ),
      ),
    ).toEqual(['in_scope', 'out_of_scope']);
  });

  it('orders in-scope documents by relevance under a hard scope', () => {
    const documents = [
      doc({
        sectionNumber: 1,
        sectionName: 'Week 1',
        contentType: 'low',
        text: 'brief mention of bonding',
      }),
      doc({
        sectionNumber: 1,
        sectionName: 'Week 1',
        contentType: 'high',
        text: 'bonding electrons orbitals covalent detail',
      }),
      doc({
        sectionNumber: 4,
        sectionName: 'Week 4',
        contentType: 'excluded',
        text: 'bonding electrons orbitals covalent detail as well',
      }),
    ];

    const prompt = formatDocumentsForPrompt(
      documents,
      { sectionNumbers: [1], hardSectionScope: true },
      'explain bonding of electrons in orbitals',
    );

    expect(contentTypes(prompt)).toEqual(['high', 'low']);
  });
});
