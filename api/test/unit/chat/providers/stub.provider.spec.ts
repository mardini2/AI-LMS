import { StubLlmProvider, isStubLlmEnabled } from '../../../../src/chat/providers/stub.provider';

describe('StubLlmProvider', () => {
  const stub = new StubLlmProvider();

  it('is always configured and echoes the student message', async () => {
    expect(stub.isConfigured()).toBe(true);
    const result = await stub.chat({
      systemInstruction: 'Stay on course.',
      history: [{ role: 'user', content: 'earlier' }],
      message: 'What is a page fault?',
      tools: [
        {
          name: 'propose_practice_quiz',
          description: 'unused',
          parameters: { type: 'object', properties: {} },
        },
      ],
    });
    expect(result.text).toBe('Behat stub: What is a page fault?');
    expect(result.toolCalls).toEqual([]);
  });

  it('does not invent a tool call when the student message is blank', async () => {
    const result = await stub.chat({
      systemInstruction: 'Stay on course.',
      history: [],
      message: '   ',
    });
    expect(result.text).toBe('Behat stub: (empty)');
  });

  it('returns empty topic JSON so study-tool side paths stay quiet', async () => {
    await expect(
      stub.generateJson({ prompt: 'Suggest topics', schemaName: 'topic_suggestions' }),
    ).resolves.toBe('{"topics":[]}');
  });
});

describe('isStubLlmEnabled', () => {
  it.each([true, 'true', '1'])('treats %p as on', (value) => {
    expect(isStubLlmEnabled(value)).toBe(true);
  });

  it.each([false, 'false', '0', '', undefined, null])('treats %p as off', (value) => {
    expect(isStubLlmEnabled(value)).toBe(false);
  });
});
