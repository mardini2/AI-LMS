/**
 * Detect "thanks"-style acknowledgments so we can reply briefly instead of
 * re-dumping the last answer. Pure gratitude only — if they also ask something
 * new, return false and let the normal chat path handle it.
 */

const GRATITUDE_RE =
  /\b(?:thank\s+you|thanks|thx|ty|appreciate(?:\s+it)?|much\s+appreciated)\b/i;

const GRATITUDE_REPLIES = [
  "You're welcome!",
  'Happy to help!',
  'No problem. Let me know if you need anything else.',
  'Glad it helped!',
  "You're welcome — ask anytime if you want to dig into something else.",
];

export function isPrimaryGratitudeMessage(raw: string): boolean {
  const original = String(raw ?? '').trim();
  if (!original || original.length > 180) return false;
  if (!GRATITUDE_RE.test(original)) return false;
  // A question mark almost always means they still want something.
  if (original.includes('?')) return false;

  let text = original
    .toLowerCase()
    .replace(/[!.,:;]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  text = text
    .replace(/\bmuch\s+appreciated\b/g, ' ')
    .replace(/\bappreciate(?:\s+it)?\b/g, ' ')
    .replace(/\bthank\s+you\b/g, ' ')
    .replace(/\bthanks\b/g, ' ')
    .replace(/\bthx\b/g, ' ')
    .replace(/\bty\b/g, ' ')
    .replace(
      /\b(?:ok(?:ay)?|alright|cool|great|awesome|perfect|got\s+it|sounds\s+good|nice|sure|yep|yeah|yes|oh)\b/g,
      ' ',
    )
    .replace(/\b(?:so\s+much|a\s+lot|again|very\s+much)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // "thanks for the help / for explaining X" is still just gratitude.
  if (/^for\b/.test(text)) return true;

  return text.length === 0;
}

/** Pick a short natural reply. Stable for a given message so retries don't jump. */
export function pickGratitudeReply(seed?: string): string {
  if (!GRATITUDE_REPLIES.length) return "You're welcome!";
  let hash = 0;
  const key = String(seed ?? Date.now());
  for (let i = 0; i < key.length; i++) {
    hash = (hash + key.charCodeAt(i) * (i + 1)) % 2147483647;
  }
  return GRATITUDE_REPLIES[hash % GRATITUDE_REPLIES.length];
}
