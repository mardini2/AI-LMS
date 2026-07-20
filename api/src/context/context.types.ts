export interface CourseContextFilter {
  sectionId?: number;
  sectionNumber?: number;
  sectionName?: string;
  sectionIds?: number[];
  sectionNumbers?: number[];
  /** When true with any section constraint, exclude out-of-scope documents entirely. */
  hardSectionScope?: boolean;
}

export interface ResolvedSectionScope {
  sectionIds: number[];
  sectionNumbers: number[];
  /** True when the scope named specific weeks/sections but none matched the course. */
  unresolvedSpecificScope?: boolean;
}

export interface ConversationSectionHint {
  sectionId?: number;
  sectionNumber?: number;
  sectionName?: string;
}

export interface StudentPlacement {
  sectionId: number;
  sectionNum: number;
  groupId: number;
  groupName: string;
  availabilityJson: string;
}

export interface PracticeQuizQuestionAnswer {
  text: string;
  fraction: number;
}

export interface PracticeQuizQuestion {
  type: 'multichoice' | 'truefalse';
  name: string;
  questiontext: string;
  answers: PracticeQuizQuestionAnswer[];
}

export interface CreatedPracticeQuiz {
  quizId: number;
  cmId: number;
  name: string;
  viewUrl: string;
}

export interface CreatedStudyGuide {
  pageId: number;
  cmId: number;
  name: string;
  viewUrl: string;
}

export interface PracticeAttemptQuestion {
  slot: number;
  name: string;
  questiontext: string;
  studentanswer: string;
  rightanswer: string;
  iscorrect: boolean;
  mark: number;
  maxmark: number;
}

export interface PracticeAttemptReview {
  hasAttempt: boolean;
  attemptId: number;
  state: string;
  score: number;
  maxScore: number;
  questions: PracticeAttemptQuestion[];
}

/** Internal document shape used by course-content ingestion and prompt helpers. */
export interface CourseContextDocument {
  courseId: number;
  courseName?: string;
  sectionId?: number;
  sectionNumber?: number;
  sectionName?: string;
  moduleId?: number;
  moduleName?: string;
  contentType: string;
  fileName?: string;
  source?: string;
  lastUpdated?: number;
  text: string;
}

export interface CourseSectionMeta {
  sectionId: number;
  sectionNumber: number;
  sectionName?: string;
}
