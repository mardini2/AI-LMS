// goal: list courses for the signed-in role and let staff create new ones.

import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { Link } from 'react-router-dom'
import { useState } from 'react'
import { z } from 'zod'
import { apiClient } from '../api/client'
import {
  Button,
  CARD_HOVER_CLASS,
  Card,
  EmptyState,
  Input,
  Modal,
  PageHeader,
  Textarea,
} from '../components/ui'
import { authStorage } from '../features/auth/auth-storage'
import { COURSE_BACKGROUND_OPTIONS } from '../constants/course-backgrounds'

const createCourseSchema = z.object({
  title: z.string().min(3),
  description: z.string().optional(),
  backgroundImage: z.string().optional(),
})

type CreateCourseValues = z.infer<typeof createCourseSchema>

interface CourseListItem {
  id: string
  title: string
  description?: string
  backgroundImage?: string
  instructor?: { fullName: string }
}

export function CoursesPage() {
  const queryClient = useQueryClient()
  const session = authStorage.get()
  const canCreate = session?.user.role === 'ADMIN' || session?.user.role === 'INSTRUCTOR'
  const [showCreateCourseModal, setShowCreateCourseModal] = useState(false)

  const coursesQuery = useQuery<CourseListItem[]>({
    queryKey: ['courses'],
    queryFn: apiClient.listCourses,
  })

  const createMutation = useMutation({
    mutationFn: apiClient.createCourse,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['courses'] })
    },
  })

  const { register, handleSubmit, reset } = useForm<CreateCourseValues>({
    resolver: zodResolver(createCourseSchema),
    defaultValues: { backgroundImage: COURSE_BACKGROUND_OPTIONS[0] },
  })

  return (
    <div className="space-y-6">
      <PageHeader
        title="Courses"
        description="Create and manage courses, modules, and content for your classes."
        actions={
          canCreate ? (
            <Button
              variant="primary"
              onClick={() => setShowCreateCourseModal(true)}
            >
              New course
            </Button>
          ) : undefined
        }
      />

      {!coursesQuery.isLoading && (coursesQuery.data?.length ?? 0) === 0 && (
        <EmptyState
          title="No courses yet"
          description="Create your first course to start building modules and content items."
        />
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {coursesQuery.data?.map((course) => (
          <Card
            key={course.id}
            className={`overflow-hidden border-slate-200 bg-slate-50/70 p-0 transition duration-200 ${CARD_HOVER_CLASS}`}
          >
            <div
              className="relative h-32 w-full bg-slate-200 bg-cover bg-center"
              style={{
                backgroundImage: `url(${course.backgroundImage ?? COURSE_BACKGROUND_OPTIONS[0]})`,
              }}
            >
              <div className="absolute inset-0 bg-slate-900/20" />
            </div>
            <div className="space-y-4 p-5">
              <div className="space-y-1">
                <p className="text-lg font-semibold text-slate-900">{course.title}</p>
                <p className="text-sm text-slate-500">{course.description ?? 'No description'}</p>
                {course.instructor?.fullName && (
                  <p className="text-xs text-slate-500">Instructor: {course.instructor.fullName}</p>
                )}
              </div>
              <div className="flex items-center justify-between gap-2">
                <Link className="text-sm font-medium text-slate-800 underline underline-offset-4" to={`/courses/${course.id}`}>
                  Open course details
                </Link>
              </div>
            </div>
          </Card>
        ))}
      </div>

      <Modal
        open={showCreateCourseModal}
        title="Create new course"
        description="Add a course shell first, then create modules and content inside it."
        onClose={() => setShowCreateCourseModal(false)}
      >
        <form
          className="space-y-3"
          onSubmit={handleSubmit((values) =>
            createMutation.mutate(values, {
              onSuccess: () => {
                reset()
                setShowCreateCourseModal(false)
              },
            }),
          )}
        >
          <Input placeholder="Course title" {...register('title')} />
          <Textarea placeholder="Description (optional)" {...register('description')} />
          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Course cover</p>
            <div className="grid grid-cols-3 gap-2">
              {COURSE_BACKGROUND_OPTIONS.map((imagePath) => (
                <label key={imagePath} className="relative cursor-pointer">
                  <input
                    type="radio"
                    value={imagePath}
                    className="peer sr-only"
                    {...register('backgroundImage')}
                  />
                  <div
                    className="h-16 rounded-lg border border-slate-300 bg-cover bg-center transition peer-checked:ring-2 peer-checked:ring-slate-700"
                    style={{ backgroundImage: `url(${imagePath})` }}
                  />
                </label>
              ))}
            </div>
          </div>
          <div className="flex gap-2">
            <Button type="submit" disabled={createMutation.isPending}>
              {createMutation.isPending ? 'Creating...' : 'Save course'}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setShowCreateCourseModal(false)}
            >
              Cancel
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
