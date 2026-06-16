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
    const {
      courseId,
      courseName,
      moodleUserId,
      userFirstName,
      message,
      conversationId: incomingConvId,
    } = dto;

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
      const conversation = await this.conversationService.create(
        courseId,
        moodleUserId,
      );
      conversationId = conversation.id;
    }

    // ── 2. Fetch course context (cached) ─────────────────────────────────────
    const [courseMaterial, resolvedCourseName, enrolledCourses] =
      await Promise.all([
        this.contextService.getContext(courseId, message),
        this.contextService.resolveCourseName(courseId, courseName),
        moodleUserId
          ? this.contextService.getEnrolledCourseNames(moodleUserId)
          : Promise.resolve([]),
      ]);

    // ── 3. Load persisted history from DB ────────────────────────────────────
    const dbHistory = await this.conversationService.getHistory(conversationId);

    // ── 4. Build the Gemini prompt ────────────────────────────────────────────
    // systemInstruction must be passed to getGenerativeModel (string accepted),
    // not to startChat (which requires a Content object in the v1beta API).
    const model = this.genAI.getGenerativeModel({
      model: 'gemini-3.1-flash-lite',
      systemInstruction: buildSystemPrompt({
        courseId,
        courseName: resolvedCourseName,
        userFirstName,
        enrolledCourses,
        courseMaterial,
      }),
      safetySettings: [
        {
          category: HarmCategory.HARM_CATEGORY_HARASSMENT,
          threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
        },
      ],
    });

    const chat = model.startChat({
      history: toGeminiHistory(dbHistory),
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

function buildSystemPrompt(ctx: {
  courseId: number;
  courseName?: string;
  userFirstName?: string;
  enrolledCourses: string[];
  courseMaterial: string;
}): string {
  const lines: string[] = [
    'You are Syllentras AI, a helpful teaching assistant. Answer the student\'s questions clearly and accurately.',
    'Format responses with markdown (headings, bold, lists) when it improves readability.',
  ];

  if (ctx.userFirstName?.trim()) {
    lines.push(
      `The student's first name is ${ctx.userFirstName.trim()}. Address them by name occasionally when it feels natural — not in every sentence.`,
    );
  }

  if (ctx.enrolledCourses.length > 0) {
    lines.push(
      `The student is enrolled in: ${ctx.enrolledCourses.join(', ')}.`,
    );
  }

  if (ctx.courseId > 1 && ctx.courseName) {
    lines.push(`The student is currently viewing the course: ${ctx.courseName}.`);
    lines.push(
      'Use the course material below as your primary source. If the answer is not in the material, say so honestly and offer general guidance.',
    );
  } else if (ctx.courseId > 1) {
    lines.push(`The student is currently viewing course ID ${ctx.courseId}.`);
  } else {
    lines.push(
      'The student is on the dashboard or site home, not a specific course page. Answer based on general knowledge or their enrolled courses listed above.',
    );
  }

  if (ctx.courseMaterial) {
    lines.push('', 'Course Material:', '---', ctx.courseMaterial, '---');
  }

  return lines.join('\n');
}

type GeminiHistoryEntry = {
  role: 'user' | 'model';
  parts: [{ text: string }];
};

/** Gemini requires history to start with 'user' and alternate user/model turns. */
function toGeminiHistory(
  history: Array<{ role: 'user' | 'assistant'; content: string }>,
): GeminiHistoryEntry[] {
  const geminiHistory: GeminiHistoryEntry[] = [];

  for (const m of history) {
    const role: 'user' | 'model' =
      m.role === 'assistant' ? 'model' : 'user';

    if (geminiHistory.length === 0 && role === 'model') {
      continue;
    }

    const last = geminiHistory[geminiHistory.length - 1];
    if (last?.role === role) {
      last.parts[0].text += `\n${m.content}`;
      continue;
    }

    geminiHistory.push({ role, parts: [{ text: m.content }] });
  }

  return geminiHistory;
}
