import { marked } from 'marked';
import type { CourseContextFilter } from '../context/context.types';
import type { StudyGuidePayload } from './entities/pending-action.entity';
import { scrubQuizGenerationContext } from './practice-quiz.helpers';

export { scrubQuizGenerationContext as scrubStudyGuideContext };

export interface StudyGuideSection {
  heading: string;
  bodyMarkdown: string;
}

export interface StudyGuideDocument {
  title: string;
  introMarkdown?: string;
  sections: StudyGuideSection[];
}

const ALLOWED_TAGS = new Set([
  'h1',
  'h2',
  'h3',
  'h4',
  'p',
  'ul',
  'ol',
  'li',
  'strong',
  'em',
  'b',
  'i',
  'code',
  'pre',
  'br',
  'blockquote',
]);

export function buildStudyGuideContextFilter(
  payload: Pick<
    StudyGuidePayload,
    | 'sectionId'
    | 'sectionNumber'
    | 'sectionName'
    | 'sectionIds'
    | 'sectionNumbers'
  >,
): CourseContextFilter {
  const sectionIds = payload.sectionIds?.filter((id) => id > 0) ?? [];
  const sectionNumbers = payload.sectionNumbers ?? [];
  const hardScoped = sectionIds.length > 0 || sectionNumbers.length > 0;

  if (hardScoped) {
    return {
      sectionIds,
      sectionNumbers,
      hardSectionScope: true,
    };
  }

  return {
    sectionId: payload.sectionId,
    sectionNumber: payload.sectionNumber,
    sectionName: payload.sectionName,
  };
}

export function buildStudyGuideProposalMessage(input: {
  title: string;
  scopeSummary: string;
}): string {
  return [
    `I can create a **private study guide** Page in Moodle for you.`,
    '',
    `**${input.title}**`,
    `- Covers: ${input.scopeSummary}`,
    `- Formatted study notes (concepts, procedures, key takeaways)`,
    `- Practice aid only — not graded`,
    `- Placed under **AI Content** (only you and instructors can see it)`,
    '',
    'Nothing will be created until you press **Confirm**. Use **Cancel** to discard this plan.',
  ].join('\n');
}

export function normalizeStudyGuideDocument(
  raw: Partial<StudyGuideDocument> | null | undefined,
): StudyGuideDocument | null {
  if (!raw) {
    return null;
  }
  const title = stripUnsafeText(String(raw.title ?? '')).trim();
  const introMarkdown = raw.introMarkdown
    ? stripUnsafeText(String(raw.introMarkdown)).trim()
    : undefined;
  const sections = (raw.sections ?? [])
    .map((s) => ({
      heading: stripUnsafeText(String(s?.heading ?? '')).trim(),
      bodyMarkdown: stripUnsafeText(String(s?.bodyMarkdown ?? '')).trim(),
    }))
    .filter((s) => s.heading.length > 0 && s.bodyMarkdown.length > 0);

  if (!title || sections.length < 1) {
    return null;
  }

  return {
    title: title.slice(0, 200),
    introMarkdown: introMarkdown || undefined,
    sections: sections.slice(0, 12),
  };
}

export function renderStudyGuideHtml(doc: StudyGuideDocument): string {
  const parts: string[] = [
    '<div class="syll-sg" data-syll-sg="1">',
  ];

  if (doc.introMarkdown) {
    parts.push(markdownToSafeHtml(doc.introMarkdown));
  }

  for (const section of doc.sections) {
    parts.push(`<h2>${escapeHtml(section.heading)}</h2>`);
    parts.push(markdownToSafeHtml(section.bodyMarkdown));
  }

  parts.push(
    '<p><em>Private study guide created by Syllentras AI. This is a practice aid and is not graded.</em></p>',
    '</div>',
  );

  return parts.filter(Boolean).join('\n');
}

export function stripUnsafeText(text: string): string {
  return text
    .replace(/\[([^\]]*)\]\((https?:\/\/[^)]+|mailto:[^)]+)\)/gi, '$1')
    .replace(/https?:\/\/[^\s)\]>"']+/gi, '')
    .replace(/www\.[^\s)\]>"']+/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export function markdownToSafeHtml(markdown: string): string {
  const raw = marked.parse(markdown, { async: false, breaks: true }) as string;
  return sanitizeStudyGuideHtml(raw);
}

/** Sanitize HTML for study-guide page body (same allowlist as generation). */
export function sanitizeStudyGuideHtml(html: string): string {
  // Drop tags (and their content for script/style) that are not on the allowlist.
  // Allow syll-sg wrapper for edit targeting.
  const allowed = new Set([...ALLOWED_TAGS, 'div']);
  let out = html
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<\/?([a-z0-9]+)(\s[^>]*)?>/gi, (match, tag: string) => {
      const name = tag.toLowerCase();
      if (!allowed.has(name)) {
        return '';
      }
      if (match.startsWith('</')) {
        return `</${name}>`;
      }
      if (name === 'br') {
        return '<br>';
      }
      if (name === 'div') {
        // Preserve syll-sg marker attributes only.
        if (/\bdata-syll-sg\b/i.test(match) || /\bsyll-sg\b/i.test(match)) {
          return '<div class="syll-sg" data-syll-sg="1">';
        }
        return '<div>';
      }
      return `<${name}>`;
    });

  out = out.replace(/https?:\/\/[^\s<]+/gi, '');
  return out.trim();
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
