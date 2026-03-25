# API routes (current)

this file is the current route map from controller decorators in `apps/api/src`.

## auth

- `POST /auth/login`
- `GET /auth/me`

## health

- `GET /health`

## users (admin only)

- `GET /users`
- `POST /users`
- `PATCH /users/:id/role`
- `GET /users/:id/enrollments`
- `PATCH /users/:id/enrollments/add`
- `PATCH /users/:id/enrollments/remove`
- `DELETE /users/:id`

## courses

- `GET /courses`
- `GET /courses/my-enrollments`
- `POST /courses`
- `GET /courses/:id`
- `PATCH /courses/:id`
- `DELETE /courses/:id`
- `GET /courses/:id/announcements`
- `POST /courses/:id/announcements`

## modules

- `GET /courses/:courseId/modules`
- `POST /courses/:courseId/modules`
- `GET /modules/:id`
- `PATCH /modules/:id`
- `DELETE /modules/:id`

## content and submissions

- `GET /modules/:moduleId/content-items`
- `POST /modules/:moduleId/content-items`
- `GET /content-items/:id`
- `PATCH /content-items/:id`
- `DELETE /content-items/:id`
- `POST /content-items/:id/submissions`
- `PATCH /content-items/:id/submissions/draft`
- `GET /students/me/submissions`
- `PATCH /submissions/:submissionId/grade`
- `POST /content-items/:id/resources`
- `GET /content-items/:id/resources`
- `POST /content-items/:id/submissions/attachments`
- `GET /content-items/:id/submissions/my/attachments`
- `DELETE /content-items/:id/submissions/attachments/:attachmentId`
- `GET /attachments/:attachmentId/download`

## reviews

- `POST /reviews/content-items/:contentItemId/request`
- `GET /reviews/content-items/:contentItemId/history`
- `GET /reviews/:reviewRequestId`
- `PATCH /reviews/:reviewRequestId/decision`

## AI

- `POST /ai/coaching/content-items/:contentItemId/chat`
- `GET /ai/coaching/content-items/:contentItemId/history`
- `POST /ai/student-guidance/content-items/:contentItemId`

## dashboard

- `GET /dashboard/overview`
- `GET /dashboard/recent-activity`

## notifications

- `GET /notifications`
- `GET /notifications/unread-count`
- `PATCH /notifications/mark-all-read`

## calendar

- `GET /calendar-events`
- `POST /calendar-events`
