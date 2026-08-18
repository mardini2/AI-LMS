import { describe, expect, it } from '@jest/globals';
import { buildSystemPrompt } from '../../../src/chat/chat.prompts';
import {
  isPrimaryGratitudeMessage,
  pickGratitudeReply,
} from '../../../src/chat/chat-gratitude';

describe('gratitude / acknowledgment handling', () => {
  it('detects common thank-you messages as primary gratitude', () => {
    const positives = [
      'thanks',
      'thanks!',
      'thank you',
      'ok thank you',
      'okay thanks',
      'appreciate it',
      'thx',
      'ty',
      'thanks so much',
      'thank you a lot',
      'much appreciated',
      'thanks for the help',
      'thank you for explaining that',
    ];
    for (const msg of positives) {
      expect(isPrimaryGratitudeMessage(msg)).toBe(true);
    }
  });

  it('does not treat thank-yous with a new question or request as pure gratitude', () => {
    const negatives = [
      'thanks, can you also explain paging?',
      'thank you. what about week 3?',
      'thanks - make me a quiz',
      'appreciate it, now how does virtual memory work?',
      'thanks, please create flashcards',
      'ok thank you, also tell me the deadline',
      'what is paging?',
      'hello',
      '',
    ];
    for (const msg of negatives) {
      expect(isPrimaryGratitudeMessage(msg)).toBe(false);
    }
  });

  it('picks a short natural acknowledgment reply', () => {
    const reply = pickGratitudeReply('thanks');
    expect(reply.length).toBeGreaterThan(0);
    expect(reply.length).toBeLessThan(120);
    expect(reply).toMatch(/welcome|help|problem|glad|ask/i);
    // Same seed --> same reply (stable if they retry).
    expect(pickGratitudeReply('thanks')).toBe(reply);
  });

  it('documents gratitude behavior in the system prompt', () => {
    const text = buildSystemPrompt({
      courseId: 7,
      courseName: 'Operating Systems',
      enrolledCourses: ['Operating Systems'],
      courseMaterial: 'Paging maps pages to frames.',
      canProposeContent: true,
      conversationStarted: true,
    });
    expect(text).toMatch(/primarily gratitude or acknowledgment/i);
    expect(text).toMatch(/Do not repeat your previous answer/i);
    expect(text).toMatch(/new question or request/i);
  });
});
