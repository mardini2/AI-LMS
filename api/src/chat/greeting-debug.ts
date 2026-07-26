import { Logger } from '@nestjs/common';

const logger = new Logger('GreetingDebug');

export function isGreetingDebugEnabled(): boolean {
  const flag = process.env.CHAT_GREETING_DEBUG?.trim().toLowerCase();
  // Default ON while investigating ignored follow-up greeting rules.
  // Set CHAT_GREETING_DEBUG=0 to disable.
  if (flag === '0' || flag === 'false' || flag === 'no') return false;
  if (flag === '1' || flag === 'true' || flag === 'yes') return true;
  return true;
}

/** Log only for the second+ assistant turn (prior user turns already exist). */
export function shouldLogGreetingDebug(priorUserTurns: number): boolean {
  return isGreetingDebugEnabled() && priorUserTurns >= 1;
}

export function logGreetingDebug(section: string, detail: string): void {
  if (!isGreetingDebugEnabled()) return;
  logger.warn(`[GREETING_DEBUG] ${section}\n${detail}`);
}

export function formatHistoryForLog(
  history: Array<{ role: string; content: string }>,
): string {
  if (!history.length) return '(empty)';
  return history
    .map((entry, index) => {
      const preview = entry.content.replace(/\s+/g, ' ');
      return `${index + 1}. [${entry.role}] ${preview}`;
    })
    .join('\n');
}
