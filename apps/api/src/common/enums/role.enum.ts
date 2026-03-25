// goal: single source of truth for role strings stored in JWT and Prisma.

export enum Role {
  ADMIN = 'ADMIN',
  INSTRUCTOR = 'INSTRUCTOR',
  REVIEWER = 'REVIEWER',
  STUDENT = 'STUDENT',
}
