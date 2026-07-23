export interface PendingActionDto {
  id: string;
  type: 'practice_quiz' | 'study_guide' | 'flashcards';
  title: string;
  scopeSummary: string;
  /** Present for practice quizzes only. */
  questionCount?: number;
  /** Present for flashcards only. */
  cardCount?: number;
}

export interface ReviewOfferDto {
  actionId: string;
  quizId: number;
  title: string;
  score: number;
  maxScore: number;
  wrongCount: number;
  total: number;
  scoreLabel: string;
}

export interface ReviewBlockDto {
  slot: number;
  question: string;
  studentAnswer: string;
  rightAnswer: string;
  why: string;
  citationTitle: string;
  citationSnippet?: string;
  citationUrl?: string;
}

export interface ChatResponse {
  response: string;
  conversationId: string;
  pendingAction?: PendingActionDto;
  topicSuggestions?: string[];
  quizUrl?: string;
  studyGuideUrl?: string;
  flashcardsUrl?: string;
  reviewOffer?: ReviewOfferDto;
  review?: ReviewBlockDto[];
}
