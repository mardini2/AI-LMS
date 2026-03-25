// goal: call Ollama for reviews, coaching, and guidance; persist coaching messages.

import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { AgentExecutionContext, AgentExecutionResult } from './ai.types';
import { FileAttachment, ReviewAgentType } from '@prisma/client';
import { readFile } from 'node:fs/promises';
import { Role } from '../common/enums/role.enum';

// minimal JSON shape from /api/generate
interface OllamaResponse {
  response: string;
}

@Injectable()
export class AiService {
  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async runContentReview(context: AgentExecutionContext): Promise<{
    agentResults: AgentExecutionResult[];
    summary: string;
    suggestedAction: string;
    qualityScore: number;
    confidenceLabel: 'LOW' | 'MEDIUM' | 'HIGH';
  }> {
    // four specialist "agents" with different review prompts; results get synthesized later
    const agentPrompts: Array<{
      agentType: ReviewAgentType;
      objective: string;
    }> = [
      {
        agentType: ReviewAgentType.STRUCTURE,
        objective:
          'Evaluate content structure, headings, sequencing, and missing sections.',
      },
      {
        agentType: ReviewAgentType.CLARITY,
        objective:
          'Evaluate writing clarity, readability, ambiguity, and confusing wording.',
      },
      {
        agentType: ReviewAgentType.ALIGNMENT,
        objective:
          'Evaluate alignment with module outcomes, course goals, and rubric.',
      },
      {
        agentType: ReviewAgentType.SAFETY_POLICY,
        objective:
          'Evaluate bias, inappropriate wording, policy conflicts, and safety risks.',
      },
    ];

    const agentResults: AgentExecutionResult[] = [];

    for (const agent of agentPrompts) {
      const prompt = this.buildReviewPrompt(context, agent.objective);
      const responseText = await this.generate(prompt);
      const confidenceScore = this.estimateConfidence(responseText);

      agentResults.push({
        agentType: agent.agentType,
        findings: responseText,
        confidenceScore,
        confidenceLabel: this.scoreToLabel(confidenceScore),
        suggestedActions: this.buildActionHint(agent.agentType),
      });
    }

    const synthesisPrompt = this.buildSynthesisPrompt(context, agentResults);
    const summary = await this.generate(synthesisPrompt);
    const qualityScore = this.estimateQualityScore(agentResults);
    const confidenceLabel = this.scoreToLabel(
      agentResults.reduce((sum, result) => sum + result.confidenceScore, 0) /
        agentResults.length,
    );

    return {
      agentResults,
      summary,
      suggestedAction:
        qualityScore >= 75 ? 'APPROVE_WITH_MINOR_EDITS' : 'REVISE_CONTENT',
      qualityScore,
      confidenceLabel,
    };
  }

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
        reviewRequests: {
          include: { agentReviews: true, finalSummary: true },
          orderBy: { createdAt: 'desc' },
          take: 1,
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
    await this.assertCanAccessContent({
      userId: input.userId,
      userRole: input.userRole,
      courseId: contentItem.module.course.id,
      createdById: contentItem.module.course.createdById,
      instructorId: contentItem.module.course.instructorId,
    });

    const latestReview = contentItem.reviewRequests[0];
    const studentSubmission = contentItem.submissions[0];
    const attachmentContext = await this.buildAttachmentContext({
      resources: contentItem.attachments,
      studentAttachments: studentSubmission?.attachments ?? [],
    });
    const draftContext =
      input.userRole === Role.STUDENT
        ? `Student draft answer:\n${input.studentDraft?.trim() || 'No draft provided'}`
        : `Instructor context:\nUse the content body and rubric as the source material for lesson-improvement advice.`;
    // large string template so the model sees course, review, and file hints together
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

Latest Review Summary:
${latestReview?.finalSummary?.summaryText ?? 'No summary yet'}

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

  async listCoachingHistory(input: { contentItemId: string; userId: string }) {
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

  // single POST to Ollama; non-streaming for simpler JSON parsing
  private async generate(prompt: string): Promise<string> {
    const model =
      this.configService.get<string>('OLLAMA_MODEL') ?? 'llama3.1:8b';
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

  // only peek small text-ish uploads; skip binary and huge files
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

  private buildReviewPrompt(
    context: AgentExecutionContext,
    objective: string,
  ): string {
    return `
You are an educational content quality reviewer.
Goal: ${objective}

Course: ${context.courseTitle}
Course Description: ${context.courseDescription ?? 'N/A'}
Module: ${context.moduleTitle}
Module Description: ${context.moduleDescription ?? 'N/A'}
Module Learning Outcomes: ${context.moduleLearningOutcomes ?? 'N/A'}
Content Type: ${context.contentType}
Content Title: ${context.contentTitle}
Rubric: ${context.rubricText ?? 'N/A'}

Content:
${context.contentBody}

Give a clear review in plain English with:
- key findings
- why this matters
- suggested fixes
`.trim();
  }

  private buildSynthesisPrompt(
    context: AgentExecutionContext,
    agentResults: AgentExecutionResult[],
  ): string {
    return `
You are SynthesisAgent. Combine these focused reviews into one final summary.

Course: ${context.courseTitle}
Module: ${context.moduleTitle}
Content: ${context.contentTitle}

Agent Reviews:
${agentResults
  .map((result) => `${result.agentType}: ${result.findings}`)
  .join('\n\n')}

Return a concise summary with:
- top issues
- overall quality impression
- practical next action
`.trim();
  }

  private buildActionHint(agentType: ReviewAgentType): string {
    switch (agentType) {
      case ReviewAgentType.STRUCTURE:
        return 'Add missing sections and improve content flow.';
      case ReviewAgentType.CLARITY:
        return 'Simplify wording and reduce ambiguous phrasing.';
      case ReviewAgentType.ALIGNMENT:
        return 'Map each major section to learning outcomes and rubric goals.';
      case ReviewAgentType.SAFETY_POLICY:
        return 'Remove risky statements and adjust wording for inclusivity.';
      default:
        return 'Review and revise based on findings.';
    }
  }

  private estimateConfidence(text: string): number {
    // We keep this heuristic simple for MVP and upgrade later.
    if (text.length > 700) return 0.82;
    if (text.length > 300) return 0.72;
    return 0.62;
  }

  private scoreToLabel(score: number): 'LOW' | 'MEDIUM' | 'HIGH' {
    if (score >= 0.8) return 'HIGH';
    if (score >= 0.65) return 'MEDIUM';
    return 'LOW';
  }

  private estimateQualityScore(agentResults: AgentExecutionResult[]): number {
    const averageConfidence =
      agentResults.reduce((sum, result) => sum + result.confidenceScore, 0) /
      agentResults.length;
    return Math.round(averageConfidence * 100);
  }
}
