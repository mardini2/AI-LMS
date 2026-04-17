// goal: edit module metadata and manage content items inside one course module.

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
  ConfirmModal,
  EmptyState,
  Input,
  PageHeader,
  Textarea,
} from '../components/ui'
import { authStorage } from '../features/auth/auth-storage'
import { useState } from 'react'
import { formatEnumLabel } from '../utils/format-enum-label'

interface ModuleDetail {
  id: string
  course: { id: string; title: string }
  title: string
  description?: string
  learningOutcomes?: string
  contentItems: Array<{ id: string; title: string; status: string; contentType: string; dueAt?: string }>
}

const contentSchema = z.object({
  title: z.string().min(3),
  contentType: z.enum([
    'LECTURE_NOTE',
    'ASSIGNMENT',
    'QUIZ',
    'RUBRIC',
    'POLICY_PAGE',
    'READING_MATERIAL',
  ]),
  body: z.string().min(10),
  rubricText: z.string().optional(),
  dueAt: z.string().optional(),
})

const moduleEditSchema = z.object({
  title: z.string().min(3),
  description: z.string().optional(),
  learningOutcomes: z.string().optional(),
})

function formatContentType(value: string) {
  return formatEnumLabel(value)
}

export function ModuleDetailPage() {
  const { moduleId = '' } = useParams()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const session = authStorage.get()
  const canCreate = session?.user.role === 'ADMIN' || session?.user.role === 'INSTRUCTOR'
  const [openDeleteModuleModal, setOpenDeleteModuleModal] = useState(false)
  const [showCreateContent, setShowCreateContent] = useState(false)
  const [showModuleSettings, setShowModuleSettings] = useState(false)

  const moduleQuery = useQuery<ModuleDetail>({
    queryKey: ['module', moduleId],
    queryFn: () => apiClient.getModule(moduleId),
    enabled: Boolean(moduleId),
  })

  const MAX_FILES_PER_BATCH = 10

  const [resourceFiles, setResourceFiles] = useState<File[]>([])
  const [resourceUploading, setResourceUploading] = useState(false)
  const [resourceUploadProgress, setResourceUploadProgress] = useState(0)
  const [resourceUploadTotal, setResourceUploadTotal] = useState(0)
  const [resourceUploadCurrent, setResourceUploadCurrent] = useState(0)
  const [resourceUploadError, setResourceUploadError] = useState('')

  const addFilesToSelection = (incoming: FileList | null, setter: (files: File[]) => void, existing: File[]) => {
    if (!incoming) return
    const merged = [...existing, ...Array.from(incoming)]
    setter(merged.slice(0, MAX_FILES_PER_BATCH))
  }

  const fileSelectionKey = (file: File) => `${file.name}|${file.size}|${file.lastModified}`

  const createContentMutation = useMutation({
    mutationFn: (payload: { title: string; contentType: string; body: string; rubricText?: string; dueAt?: string }) =>
      apiClient.createContentItem(moduleId, payload),
    onSuccess: async (createdContentItem) => {
      await queryClient.invalidateQueries({ queryKey: ['module', moduleId] })

      if (resourceFiles.length === 0) {
        setResourceFiles([])
        return
      }

      setResourceUploadError('')
      setResourceUploading(true)
      setResourceUploadProgress(0)
      setResourceUploadTotal(resourceFiles.length)
      setResourceUploadCurrent(0)

      const queue = resourceFiles.slice(0, MAX_FILES_PER_BATCH)
      try {
        for (let index = 0; index < queue.length; index += 1) {
          setResourceUploadCurrent(index + 1)
          await apiClient.uploadContentResource(
            createdContentItem.id,
            queue[index],
            (percent) => setResourceUploadProgress(percent),
          )
        }
        setResourceFiles([])
      } catch {
        setResourceUploadError('Failed to upload one or more resource files.')
      } finally {
        setResourceUploading(false)
      }

      await queryClient.invalidateQueries({ queryKey: ['module', moduleId] })
    },
  })

  const updateModuleMutation = useMutation({
    mutationFn: (payload: { title: string; description?: string; learningOutcomes?: string }) =>
      apiClient.updateModule(moduleId, payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['module', moduleId] })
    },
  })

  const deleteModuleMutation = useMutation({
    mutationFn: () => apiClient.deleteModule(moduleId),
    onSuccess: () => {
      const courseId = moduleQuery.data?.course.id
      if (courseId) {
        navigate(`/courses/${courseId}`)
        return
      }
      navigate('/courses')
    },
  })

  const { register, handleSubmit, reset } = useForm({
    resolver: zodResolver(contentSchema),
    defaultValues: { contentType: 'LECTURE_NOTE' },
  })

  const {
    register: registerModuleEdit,
    handleSubmit: handleSubmitModuleEdit,
  } = useForm({
    resolver: zodResolver(moduleEditSchema),
    values: {
      title: moduleQuery.data?.title ?? '',
      description: moduleQuery.data?.description ?? '',
      learningOutcomes: moduleQuery.data?.learningOutcomes ?? '',
    },
  })

  return (
    <div className="space-y-6">
      <PageHeader
        title={moduleQuery.data?.title ?? 'Module detail'}
        description={moduleQuery.data?.learningOutcomes ?? 'No learning outcomes yet.'}
        actions={<Badge variant="info">Content Items</Badge>}
      />

      {canCreate && (
        <Card className="space-y-3">
          <button
            type="button"
            className="flex w-full items-center justify-between text-left"
            onClick={() => setShowCreateContent((previous) => !previous)}
          >
            <h2 className="text-lg font-semibold">Create content item</h2>
            <span className="text-sm text-slate-500">{showCreateContent ? 'Hide' : 'Show'}</span>
          </button>
          {showCreateContent && (
            <form
              className="space-y-2"
              onSubmit={handleSubmit((values) =>
                createContentMutation.mutate(values, {
                  onSuccess: () => reset(),
                }),
              )}
            >
              <Input placeholder="Content title" {...register('title')} />
              <select
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-700 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                {...register('contentType')}
              >
                <option value="LECTURE_NOTE">Lecture Note</option>
                <option value="ASSIGNMENT">Assignment</option>
                <option value="QUIZ">Quiz</option>
                <option value="RUBRIC">Rubric</option>
                <option value="POLICY_PAGE">Policy / Instruction Page</option>
                <option value="READING_MATERIAL">Reading Material</option>
              </select>
              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-600">Due date (optional)</label>
                <Input type="datetime-local" {...register('dueAt')} />
              </div>
              <Textarea placeholder="Body text" rows={8} {...register('body')} />
              <Textarea placeholder="Rubric (optional)" {...register('rubricText')} />
              <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="text-sm font-medium text-slate-700">Resources students can download</p>
                <p className="text-xs text-slate-500">
                  Optional: upload files now; you can add/remove later in the content editor.
                </p>
                <div className="space-y-1">
                  <Input
                    type="file"
                    multiple
                    onChange={(event) => addFilesToSelection(event.target.files, setResourceFiles, resourceFiles)}
                  />
                  {resourceFiles.length > 0 && (
                    <div className="space-y-1">
                      <p className="text-xs text-slate-600">
                        Selected {resourceFiles.length} / {MAX_FILES_PER_BATCH}
                      </p>
                      {resourceFiles.map((file) => (
                        <div key={fileSelectionKey(file)} className="flex items-center justify-between gap-2">
                          <p className="truncate text-xs text-slate-500">{file.name}</p>
                          <Button
                            type="button"
                            variant="ghost"
                            className="h-7 px-2 text-xs"
                            onClick={() => {
                              const key = fileSelectionKey(file)
                              setResourceFiles((previous) => previous.filter((f) => fileSelectionKey(f) !== key))
                            }}
                          >
                            Remove
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                {resourceUploading && (
                  <p className="text-xs text-slate-600">
                    Uploading resources ({resourceUploadCurrent}/{resourceUploadTotal})… {resourceUploadProgress}%
                  </p>
                )}
                {resourceUploadError && <p className="text-sm text-rose-700">{resourceUploadError}</p>}
              </div>
              <Button
                type="submit"
                disabled={createContentMutation.isPending || resourceUploading}
              >
                {createContentMutation.isPending
                  ? 'Creating...'
                  : resourceUploading
                    ? 'Uploading resources...'
                    : 'Create content item'}
              </Button>
            </form>
          )}
        </Card>
      )}

      {canCreate && (
        <Card className="space-y-3">
          <button
            type="button"
            className="flex w-full items-center justify-between text-left"
            onClick={() => setShowModuleSettings((previous) => !previous)}
          >
            <h2 className="text-lg font-semibold">Module settings</h2>
            <span className="text-sm text-slate-500">{showModuleSettings ? 'Hide' : 'Show'}</span>
          </button>
          {showModuleSettings && (
            <form
              className="space-y-2"
              onSubmit={handleSubmitModuleEdit((values) => updateModuleMutation.mutate(values))}
            >
              <Input placeholder="Module title" {...registerModuleEdit('title')} />
              <Textarea placeholder="Module description" {...registerModuleEdit('description')} />
              <Textarea placeholder="Learning outcomes" {...registerModuleEdit('learningOutcomes')} />
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" disabled={updateModuleMutation.isPending} type="submit">
                  {updateModuleMutation.isPending ? 'Saving...' : 'Save changes'}
                </Button>
                <Button
                  variant="danger"
                  disabled={deleteModuleMutation.isPending}
                  type="button"
                  onClick={() => {
                    setOpenDeleteModuleModal(true)
                  }}
                >
                  {deleteModuleMutation.isPending ? 'Deleting...' : 'Delete module'}
                </Button>
              </div>
            </form>
          )}
        </Card>
      )}

      {!moduleQuery.isLoading && (moduleQuery.data?.contentItems.length ?? 0) === 0 && (
        <EmptyState
          title="No content items yet"
          description="Create a content item to add notes, assignments, and AI coaching."
        />
      )}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {moduleQuery.data?.contentItems.map((contentItem) => (
          <Card key={contentItem.id} className={`space-y-3 border-slate-200 bg-slate-50/70 transition duration-200 ${CARD_HOVER_CLASS}`}>
            <div className="space-y-1">
              <p className="text-base font-semibold text-slate-900">{contentItem.title}</p>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="neutral">{formatContentType(contentItem.contentType)}</Badge>
                {contentItem.dueAt && (
                  <Badge variant="warning">
                    Due {new Date(contentItem.dueAt).toLocaleString('en-GB', {
                      day: '2-digit',
                      month: '2-digit',
                      year: 'numeric',
                      hour: 'numeric',
                      minute: '2-digit',
                      hour12: true,
                    })}
                  </Badge>
                )}
                <Badge variant={contentItem.status === 'APPROVED' ? 'success' : 'neutral'}>
                  {formatEnumLabel(contentItem.status)}
                </Badge>
              </div>
            </div>
            <Link className="text-sm font-medium text-slate-800 underline underline-offset-4" to={`/content-items/${contentItem.id}`}>
              Open content detail
            </Link>
          </Card>
        ))}
      </div>

      <ConfirmModal
        open={openDeleteModuleModal}
        title="Delete module"
        description="This will permanently delete the module and all content items inside it."
        confirmLabel="Delete module"
        confirmVariant="danger"
        busy={deleteModuleMutation.isPending}
        onCancel={() => setOpenDeleteModuleModal(false)}
        onConfirm={() => {
          deleteModuleMutation.mutate(undefined, {
            onSettled: () => setOpenDeleteModuleModal(false),
          })
        }}
      />
    </div>
  )
}
