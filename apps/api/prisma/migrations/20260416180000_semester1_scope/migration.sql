-- remove legacy review pipeline, notifications, calendar, announcements, audit log
-- replace ContentStatus with draft vs approved only

-- Drop dependent tables first (FK order)
DROP TABLE IF EXISTS "public"."HumanReviewDecision";
DROP TABLE IF EXISTS "public"."AgentReview";
DROP TABLE IF EXISTS "public"."FinalReviewSummary";
DROP TABLE IF EXISTS "public"."ReviewRequest";

DROP TABLE IF EXISTS "public"."Notification";
DROP TABLE IF EXISTS "public"."CourseAnnouncement";
DROP TABLE IF EXISTS "public"."CalendarEvent";
DROP TABLE IF EXISTS "public"."AuditLog";

DROP TYPE IF EXISTS "public"."ReviewStatus";
DROP TYPE IF EXISTS "public"."ReviewAgentType";
DROP TYPE IF EXISTS "public"."ConfidenceLabel";
DROP TYPE IF EXISTS "public"."HumanDecisionType";
DROP TYPE IF EXISTS "public"."NotificationType";

-- Map legacy workflow statuses onto the slimmer enum before we replace the type
UPDATE "public"."ContentItem"
SET "status" = 'DRAFT'
WHERE "status"::text IN ('IN_REVIEW', 'NEEDS_REVISION', 'REJECTED');

CREATE TYPE "public"."ContentStatus_new" AS ENUM ('DRAFT', 'APPROVED');

ALTER TABLE "public"."ContentItem" ALTER COLUMN "status" DROP DEFAULT;

ALTER TABLE "public"."ContentItem"
ALTER COLUMN "status" TYPE "public"."ContentStatus_new"
USING (
  CASE
    WHEN ("status"::text = 'APPROVED') THEN 'APPROVED'::"public"."ContentStatus_new"
    ELSE 'DRAFT'::"public"."ContentStatus_new"
  END
);

DROP TYPE "public"."ContentStatus";

ALTER TYPE "public"."ContentStatus_new" RENAME TO "ContentStatus";

ALTER TABLE "public"."ContentItem"
ALTER COLUMN "status" SET DEFAULT 'DRAFT'::"public"."ContentStatus";
