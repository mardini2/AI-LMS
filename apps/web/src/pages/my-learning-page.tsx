// student hub: enrolled courses and graded work

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

  return (
    <div className="space-y-6">
      <PageHeader
        title="My Learning"
        description="Summary of your courses and graded work."
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
          description="When your admin enrolls you in courses, they will appear on your dashboard."
        />
      )}

      <Card className="space-y-3">
        <h2 className="text-lg font-semibold text-slate-900">Marks</h2>
        {(submissionsQuery.data?.length ?? 0) === 0 && (
          <p className="text-sm text-slate-500">No graded tasks yet.</p>
        )}
        <div className="space-y-2">
          {submissionsQuery.data?.map((submission: { id: string; contentItem: { title: string; module: { course: { title: string } } }; status: string; score?: number }) => (
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
    </div>
  )
}
