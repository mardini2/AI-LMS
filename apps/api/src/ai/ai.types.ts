// goal: shared TypeScript shapes for AI review prompts and per-agent results.

import { ReviewAgentType } from '@prisma/client';

export interface AgentExecutionContext {
  courseTitle: string;
  courseDescription?: string | null;
  moduleTitle: string;
  moduleDescription?: string | null;
  moduleLearningOutcomes?: string | null;
  contentTitle: string;
  contentType: string;
  contentBody: string;
  rubricText?: string | null;
}

export interface AgentExecutionResult {
  agentType: ReviewAgentType;
  findings: string;
  confidenceLabel: 'LOW' | 'MEDIUM' | 'HIGH';
  confidenceScore: number;
  suggestedActions: string;
}
