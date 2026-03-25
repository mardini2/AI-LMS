// goal: student hub combining courses, submissions, calendar, and announcements.

import { useQuery } from '@tanstack/react-query'
import { apiClient } from '../api/client'
import { Card, EmptyState, PageHeader } from '../components/ui'
import { formatEnumLabel } from '../utils/format-enum-label'

export function MyLearningPage() {
  const coursesQuery = useQuery({
    queryKey: ['student-courses'],
    queryFn: apiClient.studentCourses,
  })

  const submissionsQuery = useQuery({
    queryKey: ['student-submissions'],
    queryFn: apiClient.listMySubmissions,
  })

  const calendarQuery = useQuery({
    queryKey: ['calendar-events'],
    queryFn: apiClient.listCalendarEvents,
  })

  // fan-out: one announcements request per enrolled course, then flatten
  const announcementsQuery = useQuery({
    queryKey: ['student-announcements', coursesQuery.data?.map((course: any) => course.id).join(',')],
    enabled: Boolean(coursesQuery.data && coursesQuery.data.length > 0),
    queryFn: async () => {
      const courses = coursesQuery.data ?? []
      const responses = await Promise.all(
        courses.map((course: any) => apiClient.listCourseAnnouncements(course.id)),
      )
      return responses.flat()
    },
  })

  return (
    <div className="space-y-6">
      <PageHeader
        title="My Learning"
        description="Marks, calendar schedule, and course announcements in one place."
      />

      {coursesQuery.isLoading && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="h-48 animate-pulse rounded-2xl bg-slate-100" />
          <div className="h-48 animate-pulse rounded-2xl bg-slate-100" />
        </div>
      )}

      {!coursesQuery.isLoading && (coursesQuery.data?.length ?? 0) === 0 && (
        <EmptyState
          title="No courses assigned"
          description="When your admin enrolls you in courses, they will appear here."
        />
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-900">Marks breakdown</h2>
          {(submissionsQuery.data?.length ?? 0) === 0 && (
            <p className="text-sm text-slate-500">No graded tasks yet.</p>
          )}
          <div className="space-y-2">
            {submissionsQuery.data?.map((submission: any) => (
              <div key={submission.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="text-sm font-medium text-slate-800">{submission.contentItem.title}</p>
                <p className="text-xs text-slate-500">
                  {submission.contentItem.module.course.title} • {formatEnumLabel(submission.status)}
                </p>
                <p className="mt-1 text-sm text-slate-700">
                  Score: {submission.score ?? 'Pending'} / 100
                </p>
              </div>
            ))}
          </div>
        </Card>

        <Card className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-900">Calendar</h2>
          {(calendarQuery.data?.length ?? 0) === 0 && (
            <p className="text-sm text-slate-500">
              No calendar events yet. Your instructor can populate this later.
            </p>
          )}
          <div className="space-y-2">
            {calendarQuery.data?.map((event: any) => (
              <div key={event.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="text-sm font-medium text-slate-800">{event.title}</p>
                <p className="text-xs text-slate-500">
                  {new Date(event.startsAt).toLocaleString('en-GB', {
                    day: '2-digit',
                    month: '2-digit',
                    year: 'numeric',
                    hour: 'numeric',
                    minute: '2-digit',
                    hour12: true,
                  })}
                </p>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card className="space-y-3">
        <h2 className="text-lg font-semibold text-slate-900">Course announcements</h2>
        {(announcementsQuery.data?.length ?? 0) === 0 && (
          <p className="text-sm text-slate-500">
            No announcements yet from your instructors.
          </p>
        )}
        <div className="space-y-2">
          {announcementsQuery.data?.map((announcement: any) => (
            <div key={announcement.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-sm font-medium text-slate-800">{announcement.title}</p>
              <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{announcement.body}</p>
              <p className="mt-1 text-xs text-slate-500">
                {new Date(announcement.createdAt).toLocaleString('en-GB', {
                  day: '2-digit',
                  month: '2-digit',
                  year: 'numeric',
                  hour: 'numeric',
                  minute: '2-digit',
                  hour12: true,
                })}
              </p>
            </div>
          ))}
        </div>
      </Card>
    </div>
  )
}
