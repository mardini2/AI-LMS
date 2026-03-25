// goal: role-specific home: staff see review metrics; students see enrolled courses.

import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiClient } from '../api/client'
import { Badge, CARD_HOVER_CLASS, Card, EmptyState, PageHeader } from '../components/ui'
import { authStorage } from '../features/auth/auth-storage'
import { COURSE_BACKGROUND_OPTIONS } from '../constants/course-backgrounds'

type MetricFilter = 'pending' | 'reviewed' | 'approved' | 'needsRevision' | 'rejected'

const metricMeta: Record<MetricFilter, { label: string; variant: 'neutral' | 'success' | 'warning' | 'danger' | 'info' }> = {
  pending: { label: 'Pending', variant: 'warning' },
  reviewed: { label: 'Reviewed', variant: 'info' },
  approved: { label: 'Approved', variant: 'success' },
  needsRevision: { label: 'Needs Revision', variant: 'warning' },
  rejected: { label: 'Rejected', variant: 'danger' },
}

export function DashboardPage() {
  const session = authStorage.get()
  const isStudent = session?.user.role === 'STUDENT'
  const [activeFilter, setActiveFilter] = useState<MetricFilter | null>(null)

  const overviewQuery = useQuery({
    queryKey: ['dashboard', 'overview'],
    queryFn: apiClient.dashboardOverview,
    enabled: !isStudent,
  })

  const recentQuery = useQuery({
    queryKey: ['dashboard', 'recent'],
    queryFn: apiClient.dashboardRecent,
    enabled: !isStudent,
  })

  const studentCoursesQuery = useQuery({
    queryKey: ['student-courses'],
    queryFn: apiClient.studentCourses,
    enabled: isStudent,
  })

  // client-side slice of the feed when a metric pill is selected
  const filteredRecent = useMemo(() => {
    const items = recentQuery.data ?? []
    if (!activeFilter) return items

    return items.filter((item: any) => {
      const reviewStatus = item.status
      const contentStatus = item.contentItem?.status

      if (activeFilter === 'reviewed') return reviewStatus === 'COMPLETED'
      if (activeFilter === 'pending') return contentStatus === 'IN_REVIEW'
      if (activeFilter === 'approved') return contentStatus === 'APPROVED'
      if (activeFilter === 'needsRevision') return contentStatus === 'NEEDS_REVISION'
      if (activeFilter === 'rejected') return contentStatus === 'REJECTED'
      return true
    })
  }, [recentQuery.data, activeFilter])

  if (isStudent) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Dashboard"
          description="Your enrolled courses and learning spaces."
        />
        {studentCoursesQuery.isLoading && (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="h-48 animate-pulse rounded-2xl bg-slate-100" />
            <div className="h-48 animate-pulse rounded-2xl bg-slate-100" />
          </div>
        )}
        {!studentCoursesQuery.isLoading && (studentCoursesQuery.data?.length ?? 0) === 0 && (
          <EmptyState
            title="No enrolled courses yet"
            description="Ask your admin or instructor to enroll you in a course."
          />
        )}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {studentCoursesQuery.data?.map((course: any) => (
            <Card
              key={course.id}
              className={`overflow-hidden p-0 transition duration-200 ${CARD_HOVER_CLASS}`}
            >
              <div
                className="relative h-32 bg-slate-200 bg-cover bg-center"
                style={{
                  backgroundImage: `url(${course.backgroundImage ?? COURSE_BACKGROUND_OPTIONS[0]})`,
                }}
              >
                <div className="absolute inset-0 bg-slate-900/20" />
              </div>
              <div className="space-y-3 p-5">
                <p className="text-lg font-semibold text-slate-900">{course.title}</p>
                <p className="text-sm text-slate-500">{course.description ?? 'No description'}</p>
                {course.instructor?.fullName && (
                  <p className="text-xs text-slate-500">Instructor: {course.instructor.fullName}</p>
                )}
                <Link
                  className="inline-block text-sm font-medium text-slate-800 underline underline-offset-4"
                  to={`/courses/${course.id}`}
                >
                  Open course
                </Link>
              </div>
            </Card>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        description="Track review throughput, quality decisions, and recent AI activity across your courses."
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        {Object.entries(overviewQuery.data ?? {}).map(([key, value]) => {
          const keyAsMetric = key as MetricFilter
          const hasMeta = keyAsMetric in metricMeta
          const meta = hasMeta ? metricMeta[keyAsMetric] : { label: key, variant: 'neutral' as const }
          const isActive = activeFilter === key
          return (
            <Card
              key={key}
              className={`relative cursor-pointer overflow-hidden transition duration-200 ${
                isActive
                  ? 'ring-2 ring-slate-400'
                  : CARD_HOVER_CLASS
              }`}
              onClick={() => {
                if (!hasMeta) return
                setActiveFilter((previous) => (previous === keyAsMetric ? null : keyAsMetric))
              }}
            >
              <div className="absolute -right-8 -top-8 h-24 w-24 rounded-full bg-slate-100" />
              <div className="relative space-y-2">
                <Badge variant={meta.variant}>{meta.label}</Badge>
                <p className="text-3xl font-semibold tracking-tight text-slate-900">{String(value)}</p>
                <p className="text-xs text-slate-500">Current count</p>
              </div>
            </Card>
          )
        })}
      </div>

      <Card className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold text-slate-900">Recent review activity</h2>
          <div className="flex items-center gap-2">
            {activeFilter && (
              <button
                className="rounded-lg border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-100"
                onClick={() => setActiveFilter(null)}
              >
                Clear filter
              </button>
            )}
            <Badge variant="info">{activeFilter ? `Filtered: ${metricMeta[activeFilter].label}` : 'Latest 10'}</Badge>
          </div>
        </div>
        {recentQuery.isLoading && (
          <div className="space-y-2">
            <div className="h-16 animate-pulse rounded-xl bg-slate-100" />
            <div className="h-16 animate-pulse rounded-xl bg-slate-100" />
            <div className="h-16 animate-pulse rounded-xl bg-slate-100" />
          </div>
        )}
        {!recentQuery.isLoading && (filteredRecent.length ?? 0) === 0 && (
          <EmptyState
            title={activeFilter ? 'No items for this filter' : 'No review activity yet'}
            description={
              activeFilter
                ? 'Try another dashboard metric or clear the filter.'
                : 'Run an AI review from a content item, then come back to see activity logs here.'
            }
          />
        )}
        <div className="space-y-3">
          {filteredRecent.map((item: any) => (
            <div
              className={`rounded-xl border bg-slate-50/70 p-4 transition duration-200 ${
                activeFilter
                  ? 'border-slate-400 ring-1 ring-slate-300'
                  : `border-slate-200 ${CARD_HOVER_CLASS}`
              }`}
              key={item.id}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium text-slate-900">{item.contentItem?.title}</p>
                <Badge variant={item.status === 'COMPLETED' ? 'success' : item.status === 'FAILED' ? 'danger' : 'warning'}>
                  {item.status}
                </Badge>
              </div>
              <p className="mt-1 text-sm text-slate-600">
                Requested by {item.requestedBy?.fullName} in {item.contentItem?.module?.course?.title}
              </p>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-200">
                <div
                  className="h-full rounded-full bg-slate-700"
                  style={{
                    width: `${Math.max(5, Math.min(100, item.finalSummary?.qualityScore ?? 5))}%`,
                  }}
                />
              </div>
              <p className="mt-1 text-xs text-slate-500">
                Quality score: {item.finalSummary?.qualityScore ?? 'N/A'}
              </p>
              <div className="mt-3 flex flex-wrap gap-3 text-sm">
                <Link
                  className="font-medium text-slate-800 underline underline-offset-4"
                  to={`/reviews/${item.id}`}
                >
                  Open review result
                </Link>
                {item.contentItem?.id && (
                  <>
                    <Link
                      className="font-medium text-slate-700 underline underline-offset-4"
                      to={`/content-items/${item.contentItem.id}`}
                    >
                      Open content item
                    </Link>
                    <Link
                      className="text-slate-500 underline underline-offset-4"
                      to={`/reviews/${item.id}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open review in new tab
                    </Link>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  )
}
