// calls ollama for coaching + student guidance; persists coaching messages

import {
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ContentStatus, FileAttachment } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { readFile } from 'node:fs/promises';
import { Role } from '../common/enums/role.enum';

interface OllamaResponse {
  response: string;
}

@Injectable()
export class AiService {
  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async askCoachingQuestion(input: {
    contentItemId: string;
    userId: string;
    userRole: Role;
    question: string;
    studentDraft?: string;
  }) {
    const contentItem = await this.prisma.contentItem.findUnique({
      where: { id: input.contentItemId },
      include: {
        module: {
          include: { course: true },
        },
        attachments: {
          where: { submissionId: null },
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
        submissions: {
          where: { studentId: input.userId },
          include: {
            attachments: {
              orderBy: { createdAt: 'desc' },
              take: 10,
            },
          },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });

    if (!contentItem) {
      throw new ServiceUnavailableException(
        'Content item context was not found',
      );
    }
    if (
      input.userRole === Role.STUDENT &&
      contentItem.status !== ContentStatus.APPROVED
    ) {
      throw new NotFoundException('Content item not found');
    }
    await this.assertCanAccessContent({
      userId: input.userId,
      userRole: input.userRole,
      courseId: contentItem.module.course.id,
      createdById: contentItem.module.course.createdById,
      instructorId: contentItem.module.course.instructorId,
    });

    const studentSubmission = contentItem.submissions[0];
    const attachmentContext = await this.buildAttachmentContext({
      resources: contentItem.attachments,
      studentAttachments: studentSubmission?.attachments ?? [],
    });
    const draftContext =
      input.userRole === Role.STUDENT
        ? `Student draft answer:\n${input.studentDraft?.trim() || 'No draft provided'}`
        : `Instructor context:\nUse the content body and rubric as the source material for lesson-improvement advice.`;

    // include course, module, and attachment context so answers stay relevant
    const prompt = `
You are Syllentra Coaching Assistant.
If the user message is simple social talk (for example: hi, hello, thanks, bye), respond naturally in one short friendly sentence only.
For all other questions, answer in a practical and direct way.

Course: ${contentItem.module.course.title}
Module: ${contentItem.module.title}
Content Type: ${contentItem.contentType}
Content Title: ${contentItem.title}

Content Body:
${contentItem.body}

Question:
${input.question}

${draftContext}

Attachment context:
${attachmentContext}

For non-social questions, respond with:
1) Short advice
2) Suggested rewrite snippet if relevant
3) Next steps
`.trim();

    const response = await this.generate(prompt);

    const message = await this.prisma.coachingMessage.create({
      data: {
        contentItemId: input.contentItemId,
        userId: input.userId,
        question: input.question,
        response,
      },
    });

    return message;
  }

  async listCoachingHistory(input: {
    contentItemId: string;
    userId: string;
    userRole: Role;
  }) {
    const contentItem = await this.prisma.contentItem.findUnique({
      where: { id: input.contentItemId },
      include: {
        module: {
          include: { course: true },
        },
      },
    });
    if (!contentItem) {
      throw new ServiceUnavailableException(
        'Content item context was not found',
      );
    }
    if (
      input.userRole === Role.STUDENT &&
      contentItem.status !== ContentStatus.APPROVED
    ) {
      throw new NotFoundException('Content item not found');
    }
    await this.assertCanAccessContent({
      userId: input.userId,
      userRole: input.userRole,
      courseId: contentItem.module.course.id,
      createdById: contentItem.module.course.createdById,
      instructorId: contentItem.module.course.instructorId,
    });

    return this.prisma.coachingMessage.findMany({
      where: {
        contentItemId: input.contentItemId,
        userId: input.userId,
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async askStudentGuidance(input: {
    contentItemId: string;
    studentId: string;
    studentQuestion: string;
  }) {
    const contentItem = await this.prisma.contentItem.findUnique({
      where: { id: input.contentItemId },
      include: {
        module: {
          include: { course: true },
        },
      },
    });

    if (!contentItem) {
      throw new ServiceUnavailableException(
        'Content item context was not found',
      );
    }
    if (contentItem.status !== ContentStatus.APPROVED) {
      throw new NotFoundException('Content item not found');
    }
    await this.assertCanAccessContent({
      userId: input.studentId,
      userRole: Role.STUDENT,
      courseId: contentItem.module.course.id,
      createdById: contentItem.module.course.createdById,
      instructorId: contentItem.module.course.instructorId,
    });

    const prompt = `
You are a student learning assistant.
Explain the instructor's request in simple, practical language.

Course: ${contentItem.module.course.title}
Module: ${contentItem.module.title}
Content Title: ${contentItem.title}
Content Type: ${contentItem.contentType}

Task Content:
${contentItem.body}

Student question:
${input.studentQuestion}

Return in this order:
1) What the instructor is asking (plain words)
2) A suggested answer structure students can follow
3) Checklist before submission
`.trim();

    const response = await this.generate(prompt);
    return { response };
  }

  private async generate(prompt: string): Promise<string> {
    const model =
      this.configService.get<string>('OLLAMA_MODEL') ?? 'llama3.2:1b';
    const baseUrl =
      this.configService.get<string>('OLLAMA_BASE_URL') ??
      'http://localhost:11434';

    const response = await fetch(`${baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        prompt,
        stream: false,
      }),
    });

    if (!response.ok) {
      throw new ServiceUnavailableException(
        'Failed to get a response from Ollama. Make sure Ollama is running.',
      );
    }

    const payload = (await response.json()) as OllamaResponse;
    return payload.response ?? 'No response generated';
  }

  private async buildAttachmentContext(input: {
    resources: FileAttachment[];
    studentAttachments: FileAttachment[];
  }): Promise<string> {
    const sections: string[] = [];

    if (input.resources.length > 0) {
      const rows = await Promise.all(
        input.resources.map(async (file, index) => {
          const snippet = await this.readTextSnippet(file);
          return `${index + 1}. ${file.originalName} (${file.mimeType}, ${file.sizeBytes} bytes)${
            snippet ? `\nSnippet:\n${snippet}` : ''
          }`;
        }),
      );
      sections.push(`Instructor resources:\n${rows.join('\n\n')}`);
    } else {
      sections.push('Instructor resources: none');
    }

    if (input.studentAttachments.length > 0) {
      const rows = await Promise.all(
        input.studentAttachments.map(async (file, index) => {
          const snippet = await this.readTextSnippet(file);
          return `${index + 1}. ${file.originalName} (${file.mimeType}, ${file.sizeBytes} bytes)${
            snippet ? `\nSnippet:\n${snippet}` : ''
          }`;
        }),
      );
      sections.push(`Student uploaded files:\n${rows.join('\n\n')}`);
    } else {
      sections.push('Student uploaded files: none');
    }

    return sections.join('\n\n');
  }

  private async readTextSnippet(file: FileAttachment): Promise<string | null> {
    const textLikeMime =
      file.mimeType.startsWith('text/') ||
      file.mimeType.includes('json') ||
      file.mimeType.includes('xml') ||
      file.mimeType.includes('javascript');
    const maxBytesForSnippet = 2 * 1024 * 1024;
    if (!textLikeMime || file.sizeBytes > maxBytesForSnippet) return null;

    try {
      const content = await readFile(file.storagePath, 'utf8');
      const trimmed = content.trim();
      if (!trimmed) return null;
      return trimmed.slice(0, 1200);
    } catch {
      return null;
    }
  }

  private async assertCanAccessContent(input: {
    userId: string;
    userRole: Role;
    courseId: string;
    createdById: string;
    instructorId?: string | null;
  }) {
    if (input.userRole === Role.ADMIN || input.userRole === Role.REVIEWER) {
      return;
    }

    if (input.userRole === Role.INSTRUCTOR) {
      const ownsCourse =
        input.createdById === input.userId ||
        input.instructorId === input.userId;
      if (!ownsCourse) {
        throw new ServiceUnavailableException(
          'Content item context was not found',
        );
      }
      return;
    }

    if (input.userRole === Role.STUDENT) {
      const enrollment = await this.prisma.enrollment.findFirst({
        where: { courseId: input.courseId, studentId: input.userId },
        select: { id: true },
      });
      if (!enrollment) {
        throw new ServiceUnavailableException(
          'Content item context was not found',
        );
      }
    }
  }
}
