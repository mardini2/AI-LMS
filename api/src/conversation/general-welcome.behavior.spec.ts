import { buildSystemPrompt } from '../chat/chat.prompts';
import {
  buildGeneralWelcomeMessage,
  isGeneralWelcomeMessage,
} from './conversation.service';

describe('general chat welcome', () => {
  it('uses the course-coach welcome on Main', () => {
    const text = buildGeneralWelcomeMessage(7);
    expect(text).toContain("I'm Syllentras AI, your course coach.");
    expect(text).toMatch(/study guide, flashcards, or a practice quiz/i);
    expect(text).toContain('You can chat in any language.');
    expect(text).toContain('Mic language can be changed in Accessibility.');
    expect(isGeneralWelcomeMessage(text)).toBe(true);
  });

  it('uses the learning-coach welcome on Home/dashboard', () => {
    const text = buildGeneralWelcomeMessage(1);
    expect(text).toContain("I'm Syllentras AI, your learning coach.");
    expect(text).toMatch(/enrolled courses/i);
    expect(text).toContain('You can chat in any language.');
    expect(text).toContain('Mic language can be changed in Accessibility.');
    expect(isGeneralWelcomeMessage(text)).toBe(true);
  });

  it('asks hi-replies to stay short and light on mic talk', () => {
    const fresh = buildSystemPrompt({
      courseId: 7,
      courseName: 'Operating Systems',
      enrolledCourses: ['Operating Systems'],
      courseMaterial: 'Paging maps pages to frames.',
      canProposeContent: false,
      conversationStarted: false,
      conversationType: 'general',
    });
    expect(fresh).toMatch(/You can chat with me in any language/i);
    expect(fresh).toMatch(/no Mic\/Accessibility lecture/i);
    expect(fresh).toMatch(/open the course page while logged in/i);

    const withTools = buildSystemPrompt({
      courseId: 7,
      courseName: 'Operating Systems',
      enrolledCourses: ['Operating Systems'],
      courseMaterial: 'Paging maps pages to frames.',
      canProposeContent: true,
      conversationStarted: false,
      conversationType: 'general',
    });
    expect(withTools).toMatch(/You can chat with me in any language/i);
    expect(withTools).toMatch(/no long bullet lists/i);
  });

  it('does not treat the old filtered welcome as our new one', () => {
    expect(
      isGeneralWelcomeMessage('What would you like to know about this course?'),
    ).toBe(false);
    expect(
      isGeneralWelcomeMessage(
        "Hi! I'm Syllentras AI — ask me anything about this course.\nThe mic starts in English.",
      ),
    ).toBe(false);
  });
});
