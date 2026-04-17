// home: enrolled courses for students; course count for staff

import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { apiClient } from '../api/client'
import { Card, EmptyState, PageHeader, CARD_HOVER_CLASS } from '../components/ui'
import { authStorage } from '../features/auth/auth-storage'
import { COURSE_BACKGROUND_OPTIONS } from '../constants/course-backgrounds'

export function DashboardPage() {
  const session = authStorage.get()
  const isStudent = session?.user.role === 'STUDENT'

  const overviewQuery = useQuery({
    queryKey: ['dashboard', 'overview'],
    queryFn: apiClient.dashboardOverview,
    enabled: !isStudent,
  })

  const studentCoursesQuery = useQuery({
    queryKey: ['student-courses'],
    queryFn: apiClient.studentCourses,
    enabled: isStudent,
  })

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
          {studentCoursesQuery.data?.map((course: { id: string; title: string; description?: string; backgroundImage?: string; instructor?: { fullName: string } }) => (
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
        description="Open a course to work with modules, content, submissions, and AI coaching."
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card className="space-y-3 p-6">
          <p className="text-sm font-medium text-slate-500">Courses you can access</p>
          <p className="text-4xl font-semibold text-slate-900">
            {overviewQuery.isLoading ? '...' : (overviewQuery.data?.courses ?? 0)}
          </p>
          <Link
            className="inline-block text-sm font-medium text-slate-800 underline underline-offset-4"
            to="/courses"
          >
            Open course list
          </Link>
        </Card>
      </div>
    </div>
  )
}
