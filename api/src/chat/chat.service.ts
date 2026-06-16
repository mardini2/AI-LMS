import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  GoogleGenerativeAI,
  HarmCategory,
  HarmBlockThreshold,
} from '@google/generative-ai';
import { ContextService } from '../context/context.service';
import { ConversationService } from '../conversation/conversation.service';
import { SendMessageDto } from './dto/send-message.dto';

export interface ChatResponse {
  response: string;
  conversationId: string;
}

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);
  private readonly genAI: GoogleGenerativeAI;

  constructor(
    private readonly config: ConfigService,
    private readonly contextService: ContextService,
    private readonly conversationService: ConversationService,
  ) {
    this.genAI = new GoogleGenerativeAI(
      this.config.get<string>('GEMINI_API_KEY')!,
    );
  }

  async sendMessage(dto: SendMessageDto): Promise<ChatResponse> {
    const { courseId, message, conversationId: incomingConvId } = dto;

    // ── 1. Resolve or create the conversation ────────────────────────────────
    let conversationId = incomingConvId;
    if (conversationId) {
      // Guard against stale IDs (e.g. table was cleared while the widget was
      // open). findById throws NotFoundException if the row is gone.
      try {
        await this.conversationService.findById(conversationId);
      } catch {
        conversationId = undefined;
      }
    }
    if (!conversationId) {
      const conversation = await this.conversationService.create(courseId);
      conversationId = conversation.id;
    }

    // ── 2. Fetch course context (cached) ─────────────────────────────────────
    const courseContext = await this.contextService.getContext(courseId, message);

    // ── 3. Load persisted history from DB ────────────────────────────────────
    const dbHistory = await this.conversationService.getHistory(conversationId);

    // ── 4. Build the Gemini prompt ────────────────────────────────────────────
    // systemInstruction must be passed to getGenerativeModel (string accepted),
    // not to startChat (which requires a Content object in the v1beta API).
    const model = this.genAI.getGenerativeModel({
      model: 'gemini-3.1-flash-lite',
      systemInstruction: buildSystemPrompt(courseContext),
      safetySettings: [
        {
          category: HarmCategory.HARM_CATEGORY_HARASSMENT,
          threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
        },
      ],
    });

    const chat = model.startChat({
      history: dbHistory.map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      })),
    });

    // ── 5. Send the message and get the response ──────────────────────────────
    this.logger.log(`Sending message for conversation ${conversationId}`);
    const result = await chat.sendMessage(message);
    const responseText = result.response.text();

    // ── 6. Persist both turns to the database ─────────────────────────────────
    await this.conversationService.appendMessages(conversationId, [
      { role: 'user', content: message },
      { role: 'assistant', content: responseText },
    ]);

    return { response: responseText, conversationId };
  }
}

function buildSystemPrompt(courseContext: string): string {
  const contextSection = courseContext
    ? `\n\nCourse Material:\n---\n${courseContext}\n---`
    : '';

  return (
    `You are Syllentras AI, a helpful teaching assistant. Answer the student's questions clearly and accurately.` +
    (courseContext
      ? ` Use only the course material provided as your primary source. If the answer is not in the material, say so honestly and offer general guidance.`
      : ` No course material is available for this page, so answer based on general knowledge.`) +
    contextSection
  );
}
