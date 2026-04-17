// single course hub: modules, roster hints, and edit flows

import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { z } from 'zod'
import { apiClient } from '../api/client'
import {
  Badge,
  Button,
  CARD_HOVER_CLASS,
  Card,
  EmptyState,
  Input,
  PageHeader,
  Textarea,
  TypedConfirmModal,
} from '../components/ui'
import { authStorage } from '../features/auth/auth-storage'
import { useState } from 'react'
import { COURSE_BACKGROUND_OPTIONS } from '../constants/course-backgrounds'

interface CourseDetail {
  id: string
  title: string
  description?: string
  backgroundImage?: string
  instructor?: { id: string; fullName: string; email: string }
  enrollments?: Array<{ student: { id: string; fullName: string; email: string } }>
  modules: Array<{ id: string; title: string; description?: string }>
}

const moduleSchema = z.object({
  title: z.string().min(3),
  description: z.string().optional(),
  learningOutcomes: z.string().optional(),
})

const courseEditSchema = z.object({
  title: z.string().min(3),
  description: z.string().optional(),
  backgroundImage: z.string().optional(),
})

export function CourseDetailPage() {
  const { courseId = '' } = useParams()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const session = authStorage.get()
  const canCreate = session?.user.role === 'ADMIN' || session?.user.role === 'INSTRUCTOR'
  const [openDeleteCourseModal, setOpenDeleteCourseModal] = useState(false)
  const [showCreateModule, setShowCreateModule] = useState(false)
  const [showStudents, setShowStudents] = useState(false)
  const [showCourseSettings, setShowCourseSettings] = useState(false)
  const [saveMessage, setSaveMessage] = useState('')

  const courseQuery = useQuery<CourseDetail>({
    queryKey: ['course', courseId],
    queryFn: () => apiClient.getCourse(courseId),
    enabled: Boolean(courseId),
  })

  const createModuleMutation = useMutation({
    mutationFn: (payload: { title: string; description?: string; learningOutcomes?: string }) =>
      apiClient.createModule(courseId, payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['course', courseId] })
    },
  })

  const updateCourseMutation = useMutation({
    mutationFn: (payload: { title: string; description?: string; backgroundImage?: string }) =>
      apiClient.updateCourse(courseId, payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['course', courseId] })
      await queryClient.invalidateQueries({ queryKey: ['courses'] })
      setSaveMessage('Course settings saved.')
      setTimeout(() => setSaveMessage(''), 2000)
    },
  })

  const deleteCourseMutation = useMutation({
    mutationFn: (confirmTitle: string) =>
      apiClient.deleteCourse(courseId, { confirmTitle }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['courses'] })
      navigate('/courses')
    },
  })

  const { register, handleSubmit, reset } = useForm({
    resolver: zodResolver(moduleSchema),
  })

  const {
    register: registerCourseEdit,
    handleSubmit: handleSubmitCourseEdit,
    reset: resetCourseEdit,
  } = useForm({
    resolver: zodResolver(courseEditSchema),
    values: {
      title: courseQuery.data?.title ?? '',
      description: courseQuery.data?.description ?? '',
      backgroundImage: courseQuery.data?.backgroundImage ?? COURSE_BACKGROUND_OPTIONS[0],
    },
  })

  return (
    <div className="space-y-6">
      <PageHeader
        title={courseQuery.data?.title ?? 'Course detail'}
        description={courseQuery.data?.description ?? 'No description provided.'}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={() => navigate('/courses')}>
              Back to courses
            </Button>
            <Badge variant="info">Modules</Badge>
          </div>
        }
      />

      {canCreate && (
        <Card className="space-y-3">
          <button
            type="button"
            className="flex w-full items-center justify-between text-left"
            onClick={() => setShowCreateModule((previous) => !previous)}
          >
            <h2 className="text-lg font-semibold">Create module</h2>
            <span className="text-sm text-slate-500">{showCreateModule ? 'Hide' : 'Show'}</span>
          </button>
          {showCreateModule && (
            <form
              className="space-y-2"
              onSubmit={handleSubmit((values) =>
                createModuleMutation.mutate(values, {
                  onSuccess: () => reset(),
                }),
              )}
            >
              <Input placeholder="Module title" {...register('title')} />
              <Textarea placeholder="Module description" {...register('description')} />
              <Textarea placeholder="Learning outcomes" {...register('learningOutcomes')} />
              <Button disabled={createModuleMutation.isPending} type="submit">
                {createModuleMutation.isPending ? 'Creating...' : 'Create module'}
              </Button>
            </form>
          )}
        </Card>
      )}

      {(session?.user.role === 'INSTRUCTOR' || session?.user.role === 'ADMIN') && (
        <Card className="space-y-3">
          <button
            type="button"
            className="flex w-full items-center justify-between text-left"
            onClick={() => setShowStudents((previous) => !previous)}
          >
            <h2 className="text-lg font-semibold">Enrolled students</h2>
            <span className="text-sm text-slate-500">{showStudents ? 'Hide' : 'Show'}</span>
          </button>
          {showStudents && (
            <>
              {(courseQuery.data?.enrollments?.length ?? 0) === 0 && (
                <p className="text-sm text-slate-500">
                  No students enrolled yet. Admin can manage enrollments from User management.
                </p>
              )}
              <div className="space-y-2">
                {courseQuery.data?.enrollments?.map((entry) => (
                  <div
                    key={entry.student.id}
                    className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700"
                  >
                    {entry.student.fullName} ({entry.student.email})
                  </div>
                ))}
              </div>
            </>
          )}
        </Card>
      )}

      {canCreate && (
        <Card className="space-y-3">
          <button
            type="button"
            className="flex w-full items-center justify-between text-left"
            onClick={() => setShowCourseSettings((previous) => !previous)}
          >
            <h2 className="text-lg font-semibold">Course settings</h2>
            <span className="text-sm text-slate-500">{showCourseSettings ? 'Hide' : 'Show'}</span>
          </button>
          {showCourseSettings && (
            <form
              className="space-y-2"
              onSubmit={handleSubmitCourseEdit((values) =>
                updateCourseMutation.mutate(values, {
                  onSuccess: () => resetCourseEdit(values),
                }),
              )}
            >
              <Input placeholder="Course title" {...registerCourseEdit('title')} />
              <Textarea placeholder="Course description" {...registerCourseEdit('description')} />
              <div className="space-y-2">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Course cover</p>
                <div className="grid grid-cols-3 gap-2">
                  {COURSE_BACKGROUND_OPTIONS.map((imagePath) => (
                    <label key={imagePath} className="relative cursor-pointer">
                      <input
                        type="radio"
                        value={imagePath}
                        className="peer sr-only"
                        {...registerCourseEdit('backgroundImage')}
                      />
                      <div
                        className="h-16 rounded-lg border border-slate-300 bg-cover bg-center transition peer-checked:ring-2 peer-checked:ring-slate-700"
                        style={{ backgroundImage: `url(${imagePath})` }}
                      />
                    </label>
                  ))}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button disabled={updateCourseMutation.isPending} type="submit" variant="secondary">
                  {updateCourseMutation.isPending ? 'Saving...' : 'Save changes'}
                </Button>
                {saveMessage && (
                  <span className="self-center text-xs text-emerald-600">{saveMessage}</span>
                )}
                <Button
                  disabled={deleteCourseMutation.isPending}
                  type="button"
                  variant="danger"
                  onClick={() => {
                    setOpenDeleteCourseModal(true)
                  }}
                >
                  {deleteCourseMutation.isPending ? 'Deleting...' : 'Delete course'}
                </Button>
              </div>
            </form>
          )}
        </Card>
      )}

      {!courseQuery.isLoading && (courseQuery.data?.modules.length ?? 0) === 0 && (
        <EmptyState
          title="No modules yet"
          description="Create a module to add lecture notes, assignments, and AI coaching."
        />
      )}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {courseQuery.data?.modules.map((moduleItem) => (
          <Card key={moduleItem.id} className={`space-y-3 border-slate-200 bg-slate-50/70 transition duration-200 ${CARD_HOVER_CLASS}`}>
            <div>
              <p className="text-base font-semibold text-slate-900">{moduleItem.title}</p>
              <p className="mt-1 text-sm text-slate-500">{moduleItem.description ?? 'No description'}</p>
            </div>
            <Link className="text-sm font-medium text-slate-800 underline underline-offset-4" to={`/modules/${moduleItem.id}`}>
              Open module workspace
            </Link>
          </Card>
        ))}
      </div>

      <TypedConfirmModal
        open={openDeleteCourseModal}
        title="Delete course"
        description="This will permanently delete the course, all modules, content items, submissions, and coaching history."
        expectedText={courseQuery.data?.title ?? ''}
        inputLabel="Type the course title to confirm"
        busy={deleteCourseMutation.isPending}
        onCancel={() => setOpenDeleteCourseModal(false)}
        onConfirm={() => {
          const currentTitle = courseQuery.data?.title
          if (!currentTitle) return
          deleteCourseMutation.mutate(currentTitle, {
            onSettled: () => setOpenDeleteCourseModal(false),
          })
        }}
      />
    </div>
  )
}
