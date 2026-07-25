import { buildSystemPrompt } from './chat.prompts';
import { preventRepeatedGreeting } from './chat.service';

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
    expect(prompt(false)).toContain(
      'This is the beginning of a new general chat.',
    );
  });

  it('forbids repeated greetings after a conversation starts', () => {
    expect(prompt(true)).toContain('Do not begin with Hi, Hello, Hey, Welcome');
    expect(
      preventRepeatedGreeting('Hello, Ali! Paging uses frames.', true, 'Ali'),
    ).toBe('Paging uses frames.');
  });

  it('preserves the section introduction but forbids another greeting', () => {
    const sectionPrompt = prompt(false, 'section');
    expect(sectionPrompt).toContain(
      'A section chat may already show an introductory message',
    );
    expect(sectionPrompt).toContain('Week 3');
  });
});
