import { buildSystemPrompt } from './chat.prompts';
import {
  normalizeHistoryForLlm,
  preventRepeatedGreeting,
  stripLeadingAssistantGreeting,
} from './chat.service';

function prompt(conversationStarted: boolean, conversationType = 'general') {
  return buildSystemPrompt({
    courseId: 7,
    courseName: 'Operating Systems',
    userFirstName: 'Ali',
    enrolledCourses: ['Operating Systems'],
    conversationTitle: conversationType === 'section' ? 'Week 3' : 'Main',
    conversationType,
    sectionName: conversationType === 'section' ? 'Week 3' : undefined,
    courseMaterial: 'Virtual memory maps pages to frames.',
    canProposeContent: true,
    conversationStarted,
  });
}

describe('conversation-aware greetings', () => {
  it('allows a natural greeting only at the start of a general chat', () => {
    const text = prompt(false, 'general');
    expect(text).toContain('beginning of a new general chat');
    expect(text).toContain('Hi Ali');
  });

  it('forbids repeated greetings after a conversation starts', () => {
    const text = prompt(true, 'general');
    expect(text).toContain('Do not begin with Hi, Hello, Hey, Welcome');
    expect(text).toContain(
      'Do not end with generic filler such as "Let me know if you have any questions"',
    );
    expect(
      preventRepeatedGreeting('Hello, Ali! Paging uses frames.', true, 'Ali'),
    ).toBe('Paging uses frames.');
  });

  it('preserves the section introduction but forbids another greeting', () => {
    const text = prompt(false, 'section');
    expect(text).toContain(
      'A section chat may already show an introductory message',
    );
    expect(text).toContain('Do not begin with Hi, Hello, Hey, Welcome');
    expect(text).not.toContain('beginning of a new general chat');
  });

  it('leaves direct answers alone when no greeting prefix is present', () => {
    expect(
      preventRepeatedGreeting(
        'Virtual memory maps pages to frames.',
        true,
        'Ali',
      ),
    ).toBe('Virtual memory maps pages to frames.');
  });

  it('does not strip greetings on a brand-new general chat', () => {
    expect(
      preventRepeatedGreeting('Hi Ali, I can help with paging.', false, 'Ali'),
    ).toBe('Hi Ali, I can help with paging.');
  });

  it('strips greeting prefixes from assistant history for the LLM only', () => {
    const history = [
      { role: 'user' as const, content: 'hello' },
      {
        role: 'assistant' as const,
        content: 'Hello Admin! Welcome to Rootkits. I can help with analysis.',
      },
      { role: 'user' as const, content: 'how many weeks?' },
      {
        role: 'assistant' as const,
        content: 'Hi Admin, There are 15 weeks in total.',
      },
    ];

    const normalized = normalizeHistoryForLlm(history, 'Admin');

    expect(normalized[0]).toEqual(history[0]);
    expect(normalized[1].content).toBe('I can help with analysis.');
    expect(normalized[2]).toEqual(history[2]);
    expect(normalized[3].content).toBe('There are 15 weeks in total.');
    // Original history object contents are not mutated.
    expect(history[1].content).toContain('Hello Admin!');
    expect(history[3].content).toContain('Hi Admin,');
  });

  it('strips bare Hi/Hello/Hey/Welcome prefixes without a name', () => {
    expect(stripLeadingAssistantGreeting('Hi, Paging uses frames.')).toBe(
      'Paging uses frames.',
    );
    expect(stripLeadingAssistantGreeting('Hello, Paging uses frames.')).toBe(
      'Paging uses frames.',
    );
    expect(stripLeadingAssistantGreeting('Hey, Paging uses frames.')).toBe(
      'Paging uses frames.',
    );
    expect(
      stripLeadingAssistantGreeting('Welcome back! Paging uses frames.'),
    ).toBe('Paging uses frames.');
  });
});
