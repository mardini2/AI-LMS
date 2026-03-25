// goal: rich content workspace: reviews, coaching chat, submissions, and uploads.

import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { z } from 'zod'
import axios from 'axios'
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
import { formatEnumLabel } from '../utils/format-enum-label'

interface ReviewHistoryItem {
  id: string
  createdAt: string
  status: string
  finalSummary?: {
    qualityScore?: number
  }
}

interface ContentItemDetail {
  id: string
  title: string
  contentType: string
  body: string
  rubricText?: string
  dueAt?: string
  status: string
  module: { id: string; title: string; course: { title: string } }
  reviewRequests: ReviewHistoryItem[]
  submissions?: Array<{
    id: string
    answerText: string
    status: 'DRAFT' | 'SUBMITTED' | 'GRADED'
    score?: number
    feedback?: string
    student: { id: string; fullName: string; email: string }
    attachments?: Array<{ id: string; originalName: string; sizeBytes: number }>
  }>
  attachments?: Array<{ id: string; originalName: string; sizeBytes: number }>
}

interface SubmissionAttachmentItem {
  id: string
  originalName: string
  sizeBytes: number
}

const coachingSchema = z.object({
  question: z.string().min(3),
})

const contentEditSchema = z.object({
  title: z.string().min(3),
  body: z.string().min(10),
  rubricText: z.string().optional(),
  dueAt: z.string().optional(),
})

function formatContentType(value?: string) {
  return formatEnumLabel(value, 'Type')
}

const MAX_FILES_PER_BATCH = 10

export function ContentItemPage() {
  const { contentId = '' } = useParams()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [openDeleteContentModal, setOpenDeleteContentModal] = useState(false)
  const session = authStorage.get()
  const isStudent = session?.user.role === 'STUDENT'
  const canEditContent = session?.user.role === 'ADMIN' || session?.user.role === 'INSTRUCTOR'
  const [showContentSettings, setShowContentSettings] = useState(false)
  const [answerText, setAnswerText] = useState('')
  const [coachingIndex, setCoachingIndex] = useState(0)
  const [resourceFiles, setResourceFiles] = useState<File[]>([])
  const [submissionFiles, setSubmissionFiles] = useState<File[]>([])
  const [resourceUploadProgress, setResourceUploadProgress] = useState(0)
  const [submissionUploadProgress, setSubmissionUploadProgress] = useState(0)
  const [resourceDropActive, setResourceDropActive] = useState(false)
  const [submissionDropActive, setSubmissionDropActive] = useState(false)
  const [resourceUploadTotal, setResourceUploadTotal] = useState(0)
  const [resourceUploadCurrent, setResourceUploadCurrent] = useState(0)
  const [submissionUploadTotal, setSubmissionUploadTotal] = useState(0)
  const [submissionUploadCurrent, setSubmissionUploadCurrent] = useState(0)
  const [resourceUploading, setResourceUploading] = useState(false)
  const [submissionUploading, setSubmissionUploading] = useState(false)
  const [resourceUploadError, setResourceUploadError] = useState('')
  const [submissionUploadError, setSubmissionUploadError] = useState('')
  const [dismissedSubmissionFiles, setDismissedSubmissionFiles] = useState<SubmissionAttachmentItem[]>([])

  const contentQuery = useQuery<ContentItemDetail>({
    queryKey: ['content-item', contentId],
    queryFn: () => apiClient.getContentItem(contentId),
    enabled: Boolean(contentId),
  })

  const coachingHistoryQuery = useQuery({
    queryKey: ['coaching-history', contentId],
    queryFn: () => apiClient.coachingHistory(contentId),
    enabled: Boolean(contentId),
  })

  const resourcesQuery = useQuery({
    queryKey: ['content-resources', contentId],
    queryFn: () => apiClient.listContentResources(contentId),
    enabled: Boolean(contentId),
  })

  const submissionAttachmentsQuery = useQuery({
    queryKey: ['submission-attachments', contentId],
    queryFn: () => apiClient.listMySubmissionAttachments(contentId),
    enabled: Boolean(contentId) && isStudent,
  })

  const removeContentResourceMutation = useMutation({
    mutationFn: (attachmentId: string) => apiClient.removeContentResource(contentId, attachmentId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['content-resources', contentId] })
    },
  })

  const reviewMutation = useMutation({
    mutationFn: () =>
      isStudent
        ? apiClient.studentGuidance(contentId, {
            question: 'Explain what the instructor is asking and how I should answer.',
          })
        : apiClient.requestReview(contentId),
    onSuccess: async () => {
      if (!isStudent) {
        await queryClient.invalidateQueries({ queryKey: ['content-item', contentId] })
      }
    },
  })

  const coachingMutation = useMutation({
    mutationFn: (payload: { question: string; studentDraft?: string }) =>
      apiClient.coachingChat(contentId, payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['coaching-history', contentId] })
    },
  })

  const updateContentMutation = useMutation({
    mutationFn: (payload: { title: string; body: string; rubricText?: string; dueAt?: string }) =>
      apiClient.updateContentItem(contentId, payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['content-item', contentId] })
    },
  })

  const deleteContentMutation = useMutation({
    mutationFn: () => apiClient.deleteContentItem(contentId),
    onSuccess: () => {
      const moduleId = contentQuery.data?.module.id
      if (moduleId) {
        navigate(`/modules/${moduleId}`)
        return
      }
      navigate('/courses')
    },
  })

  const submitAnswerMutation = useMutation({
    mutationFn: (payload: { answerText: string }) =>
      apiClient.submitStudentAnswer(contentId, payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['content-item', contentId] })
    },
  })

  const saveDraftMutation = useMutation({
    mutationFn: (payload: { answerText: string }) =>
      apiClient.saveStudentAnswerDraft(contentId, payload),
  })

  const removeSubmissionAttachmentMutation = useMutation({
    mutationFn: (attachmentId: string) =>
      apiClient.removeMySubmissionAttachment(contentId, attachmentId),
    onSuccess: async (_data, attachmentId) => {
      const removedAttachment = (submissionAttachmentsQuery.data ?? []).find(
        (item: SubmissionAttachmentItem) => item.id === attachmentId,
      )
      if (removedAttachment) {
        setDismissedSubmissionFiles((previous) => [removedAttachment, ...previous])
      }
      await queryClient.invalidateQueries({ queryKey: ['submission-attachments', contentId] })
      await queryClient.invalidateQueries({ queryKey: ['content-item', contentId] })
    },
  })

  const addFilesToSelection = (incoming: FileList | null, setter: (files: File[]) => void, existing: File[]) => {
    if (!incoming) return
    const merged = [...existing, ...Array.from(incoming)]
    setter(merged.slice(0, MAX_FILES_PER_BATCH))
  }

  const uploadResourceFiles = async () => {
    const queue = resourceFiles.slice(0, MAX_FILES_PER_BATCH)
    if (queue.length === 0 || resourceUploading) return
    setResourceUploadError('')
    setResourceUploading(true)
    setResourceUploadTotal(queue.length)
    try {
      for (let index = 0; index < queue.length; index += 1) {
        setResourceUploadCurrent(index + 1)
        setResourceUploadProgress(0)
        await apiClient.uploadContentResource(contentId, queue[index], (percent) =>
          setResourceUploadProgress(percent),
        )
      }
      setResourceFiles([])
      await queryClient.invalidateQueries({ queryKey: ['content-resources', contentId] })
    } catch (error) {
      if (axios.isAxiosError(error)) {
        setResourceUploadError(error.response?.data?.message ?? 'Failed to upload one or more files.')
      } else {
        setResourceUploadError('Failed to upload one or more files.')
      }
    } finally {
      setResourceUploading(false)
      setTimeout(() => {
        setResourceUploadProgress(0)
        setResourceUploadCurrent(0)
        setResourceUploadTotal(0)
      }, 1000)
    }
  }

  const uploadSubmissionFiles = async () => {
    const queue = submissionFiles.slice(0, MAX_FILES_PER_BATCH)
    if (queue.length === 0 || submissionUploading) return
    setSubmissionUploadError('')
    setSubmissionUploading(true)
    setSubmissionUploadTotal(queue.length)
    try {
      for (let index = 0; index < queue.length; index += 1) {
        setSubmissionUploadCurrent(index + 1)
        setSubmissionUploadProgress(0)
        await apiClient.uploadSubmissionAttachment(contentId, queue[index], (percent) =>
          setSubmissionUploadProgress(percent),
        )
      }
      setSubmissionFiles([])
      await queryClient.invalidateQueries({ queryKey: ['submission-attachments', contentId] })
      await queryClient.invalidateQueries({ queryKey: ['content-item', contentId] })
    } catch (error) {
      if (axios.isAxiosError(error)) {
        setSubmissionUploadError(error.response?.data?.message ?? 'Failed to upload one or more files.')
      } else {
        setSubmissionUploadError('Failed to upload one or more files.')
      }
    } finally {
      setSubmissionUploading(false)
      setTimeout(() => {
        setSubmissionUploadProgress(0)
        setSubmissionUploadCurrent(0)
        setSubmissionUploadTotal(0)
      }, 1000)
    }
  }

  const gradeSubmissionMutation = useMutation({
    mutationFn: (payload: { submissionId: string; score?: number; feedback?: string }) =>
      apiClient.gradeSubmission(payload.submissionId, {
        score: payload.score,
        feedback: payload.feedback,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['content-item', contentId] })
    },
  })

  const { register, handleSubmit, reset } = useForm({
    resolver: zodResolver(coachingSchema),
  })

  const {
    register: registerContentEdit,
    handleSubmit: handleSubmitContentEdit,
  } = useForm({
    resolver: zodResolver(contentEditSchema),
    values: {
      title: contentQuery.data?.title ?? '',
      body: contentQuery.data?.body ?? '',
      rubricText: contentQuery.data?.rubricText ?? '',
      dueAt: contentQuery.data?.dueAt
        ? new Date(contentQuery.data.dueAt).toISOString().slice(0, 16)
        : '',
    },
  })

  const [gradingDraft, setGradingDraft] = useState<Record<string, { score?: string; feedback?: string }>>({})

  const mySubmission = useMemo(
    () => contentQuery.data?.submissions?.[0],
    [contentQuery.data?.submissions],
  )
  const canRemoveSubmissionFiles =
    isStudent && mySubmission?.status !== 'SUBMITTED' && mySubmission?.status !== 'GRADED'

  useEffect(() => {
    if (isStudent && mySubmission?.answerText) {
      setAnswerText(mySubmission.answerText)
    }
  }, [isStudent, mySubmission?.answerText])

  useEffect(() => {
    if (!isStudent) return
    const timer = setTimeout(() => {
      if (answerText.trim().length >= 3) {
        saveDraftMutation.mutate({ answerText })
      }
    }, 900)
    return () => clearTimeout(timer)
  }, [answerText, isStudent])

  useEffect(() => {
    if (!coachingHistoryQuery.data) return
    setCoachingIndex(Math.max(0, coachingHistoryQuery.data.length - 1))
  }, [coachingHistoryQuery.data?.length])

  useEffect(() => {
    setDismissedSubmissionFiles([])
  }, [contentId])

  const activeCoachingMessage = coachingHistoryQuery.data?.[coachingIndex]

  return (
    <div className="space-y-6">
      <PageHeader
        title={contentQuery.data?.title ?? 'Content item'}
        description={`${contentQuery.data?.module.course.title ?? 'Course'} / ${contentQuery.data?.module.title ?? 'Module'}`}
        actions={
          <div className="flex items-center gap-2">
            <Badge variant="neutral">{formatContentType(contentQuery.data?.contentType)}</Badge>
            {contentQuery.data?.dueAt && (
              <Badge variant="warning">
                Due {new Date(contentQuery.data.dueAt).toLocaleString('en-GB', {
                  day: '2-digit',
                  month: '2-digit',
                  year: 'numeric',
                  hour: 'numeric',
                  minute: '2-digit',
                  hour12: true,
                })}
              </Badge>
            )}
            <Badge
              variant={
                contentQuery.data?.status === 'APPROVED'
                  ? 'success'
                  : contentQuery.data?.status === 'REJECTED'
                    ? 'danger'
                    : contentQuery.data?.status === 'NEEDS_REVISION'
                      ? 'warning'
                      : 'info'
              }
            >
              {formatEnumLabel(contentQuery.data?.status, 'Status')}
            </Badge>
          </div>
        }
      />
      {contentQuery.isError && (
        <Card>
          <p className="text-sm text-rose-700">
            Failed to load this content item. If you recently reset the database, this URL may
            point to an old deleted item.
          </p>
        </Card>
      )}

      <Card className="space-y-2">
        <h2 className="text-lg font-semibold text-slate-900">Content body</h2>
        <p className="whitespace-pre-wrap text-sm leading-6">{contentQuery.data?.body}</p>
      </Card>

      <Card className="space-y-3">
        <h2 className="text-lg font-semibold">{isStudent ? 'Task breakdown' : 'AI Review Workflow'}</h2>
        <Button disabled={reviewMutation.isPending} onClick={() => reviewMutation.mutate()}>
          {reviewMutation.isPending
            ? isStudent
              ? 'Preparing guidance...'
              : 'Running review...'
            : 'Run AI Review'}
        </Button>
        <p className="mt-2 text-xs text-slate-500">
          {isStudent
            ? 'This gives a simpler interpretation of what your instructor is asking.'
            : 'AI review can take up to 1-3 minutes.'}
        </p>
        {reviewMutation.isError && (
          <p className="mt-2 text-sm text-rose-700">
            {(() => {
              if (axios.isAxiosError(reviewMutation.error)) {
                const maybeMessage = reviewMutation.error.response?.data?.message
                if (typeof maybeMessage === 'string') return `Review failed: ${maybeMessage}`
                return 'Review failed. Please check that API and Ollama are running.'
              }
              return 'Review failed. Please try again.'
            })()}
          </p>
        )}
        {reviewMutation.isSuccess && !isStudent && (
          <p className="mt-2 text-sm text-emerald-700">
            Review completed. A new review record has been added below.
          </p>
        )}
        {reviewMutation.isSuccess && isStudent && (
          <div className="mt-2 rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm text-slate-700">
            <p className="whitespace-pre-wrap">{(reviewMutation.data as any)?.response}</p>
          </div>
        )}

        {!isStudent && (
          <div className="mt-2 space-y-2">
            {(contentQuery.data?.reviewRequests.length ?? 0) === 0 && (
              <EmptyState
                title="No review history"
                description="Run AI review to generate per-agent findings and a final synthesis."
              />
            )}
            {contentQuery.data?.reviewRequests.map((reviewRequest) => (
              <div className={`rounded-xl border border-slate-200 bg-slate-50/70 p-4 text-sm transition duration-200 ${CARD_HOVER_CLASS}`} key={reviewRequest.id}>
                <div className="flex items-center justify-between gap-2">
                  <p className="font-medium text-slate-800">Request {reviewRequest.id.slice(0, 8)}</p>
                  <Badge variant={reviewRequest.status === 'COMPLETED' ? 'success' : reviewRequest.status === 'FAILED' ? 'danger' : 'warning'}>
                    {formatEnumLabel(reviewRequest.status)}
                  </Badge>
                </div>
                <p className="mt-1 text-slate-500">
                  Quality score: {reviewRequest.finalSummary?.qualityScore ?? 'N/A'}
                </p>
                <Link className="mt-2 inline-block font-medium text-slate-800 underline underline-offset-4" to={`/reviews/${reviewRequest.id}`}>
                  Open review result
                </Link>
                <Link
                  className="ml-4 mt-2 inline-block text-sm text-slate-500 underline underline-offset-4"
                  to={`/reviews/${reviewRequest.id}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open in new tab
                </Link>
              </div>
            ))}
          </div>
        )}
      </Card>

      {!isStudent && (
        <Card className="space-y-2">
          <button
            type="button"
            className="flex w-full items-center justify-between text-left"
            onClick={() => setShowContentSettings((previous) => !previous)}
          >
            <h2 className="text-lg font-semibold">Content settings</h2>
            <span className="text-sm text-slate-500">{showContentSettings ? 'Hide' : 'Show'}</span>
          </button>
          {showContentSettings && (
            <form
              className="space-y-2"
              onSubmit={handleSubmitContentEdit((values) => updateContentMutation.mutate(values))}
            >
              <Input placeholder="Content title" {...registerContentEdit('title')} />
              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-600">Due date (optional)</label>
                <Input type="datetime-local" {...registerContentEdit('dueAt')} />
              </div>
              <Textarea rows={8} placeholder="Content body" {...registerContentEdit('body')} />
              <Textarea placeholder="Rubric text" {...registerContentEdit('rubricText')} />
              <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="text-sm font-medium text-slate-700">Resources and attachments</p>
                <p className="text-xs text-slate-500">
                  Upload files students can download while reviewing this content.
                </p>
                <div
                  className={`rounded-xl border border-dashed p-4 transition ${
                    resourceDropActive ? 'border-blue-400 bg-blue-50' : 'border-slate-300 bg-white'
                  }`}
                  onDragOver={(event) => {
                    event.preventDefault()
                    setResourceDropActive(true)
                  }}
                  onDragLeave={() => setResourceDropActive(false)}
                  onDrop={(event) => {
                    event.preventDefault()
                    setResourceDropActive(false)
                    addFilesToSelection(
                      event.dataTransfer.files,
                      setResourceFiles,
                      resourceFiles,
                    )
                  }}
                >
                  <p className="text-sm text-slate-700">Drop files here, or choose files manually.</p>
                  <Input
                    className="mt-2"
                    type="file"
                    multiple
                    onChange={(event) =>
                      addFilesToSelection(event.target.files, setResourceFiles, resourceFiles)
                    }
                  />
                  {resourceFiles.length > 0 && (
                    <div className="mt-2 space-y-1">
                      <p className="text-xs text-slate-600">
                        Selected {resourceFiles.length} / {MAX_FILES_PER_BATCH}
                      </p>
                      {resourceFiles.map((file) => (
                        <p key={file.name + file.size} className="text-xs text-slate-500">
                          {file.name}
                        </p>
                      ))}
                    </div>
                  )}
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={resourceFiles.length === 0 || resourceUploading}
                  onClick={uploadResourceFiles}
                >
                  {resourceUploading
                    ? `Uploading ${resourceUploadCurrent}/${resourceUploadTotal} (${resourceUploadProgress}%)`
                    : `Upload selected files (${resourceFiles.length})`}
                </Button>
                {resourceUploading && (
                  <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200">
                    <div
                      className="h-full rounded-full bg-blue-500 transition-all"
                      style={{ width: `${resourceUploadProgress}%` }}
                    />
                  </div>
                )}
                {resourceUploadError && (
                  <p className="text-sm text-rose-700">{resourceUploadError}</p>
                )}
                <div className="space-y-2">
                  <p className="text-sm font-medium text-slate-700">Available resources</p>
                  {(resourcesQuery.data?.length ?? 0) === 0 && (
                    <p className="text-sm text-slate-500">No resources uploaded yet.</p>
                  )}
                  {resourcesQuery.data?.map((file: any) => (
                    <div key={file.id} className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2">
                      <a
                        className="block text-sm text-slate-700 underline underline-offset-4"
                        href={`/api/attachments/${file.id}/download`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {file.originalName}
                      </a>
                      <Button
                        type="button"
                        variant="danger"
                        disabled={removeContentResourceMutation.isPending}
                        className="h-8 px-2 py-0 text-xs"
                        onClick={() => removeContentResourceMutation.mutate(file.id)}
                      >
                        Remove
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" disabled={updateContentMutation.isPending} type="submit">
                  {updateContentMutation.isPending ? 'Saving...' : 'Save changes'}
                </Button>
                <Button
                  variant="danger"
                  disabled={deleteContentMutation.isPending}
                  type="button"
                  onClick={() => {
                    setOpenDeleteContentModal(true)
                  }}
                >
                  {deleteContentMutation.isPending ? 'Deleting...' : 'Delete content item'}
                </Button>
              </div>
            </form>
          )}
        </Card>
      )}

      {isStudent && (
        <Card className="space-y-3">
          <h2 className="text-lg font-semibold">Your answer</h2>
          <p className="text-sm text-slate-500">
            Draft your response, then use AI coaching below for guidance before submitting.
          </p>
          <Textarea
            rows={8}
            placeholder="Write your answer here..."
            value={answerText}
            onChange={(event) => setAnswerText(event.target.value)}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              disabled={submitAnswerMutation.isPending}
              onClick={() =>
                submitAnswerMutation.mutate({ answerText }, {
                  onSuccess: () => {
                    queryClient.invalidateQueries({ queryKey: ['content-item', contentId] })
                  },
                })
              }
            >
              {submitAnswerMutation.isPending ? 'Submitting...' : 'Submit answer to instructor'}
            </Button>
            <p className="self-center text-xs text-slate-500">
              Draft is auto-saved.
            </p>
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <p className="text-sm font-medium text-slate-700">Submission files</p>
            <p className="mt-1 text-xs text-slate-500">
              Upload up to {MAX_FILES_PER_BATCH} supporting files (max 2GB each). Drag-drop is supported.
            </p>
            <div
              className={`mt-2 rounded-xl border border-dashed p-4 transition ${
                submissionDropActive ? 'border-blue-400 bg-blue-50' : 'border-slate-300 bg-white'
              }`}
              onDragOver={(event) => {
                event.preventDefault()
                setSubmissionDropActive(true)
              }}
              onDragLeave={() => setSubmissionDropActive(false)}
              onDrop={(event) => {
                event.preventDefault()
                setSubmissionDropActive(false)
                addFilesToSelection(
                  event.dataTransfer.files,
                  setSubmissionFiles,
                  submissionFiles,
                )
              }}
            >
              <p className="text-sm text-slate-700">Drop submission files here, or choose files manually.</p>
              <Input
                className="mt-2"
                type="file"
                multiple
                onChange={(event) =>
                  addFilesToSelection(event.target.files, setSubmissionFiles, submissionFiles)
                }
              />
              {submissionFiles.length > 0 && (
                <div className="mt-2 space-y-1">
                  <p className="text-xs text-slate-600">
                    Selected {submissionFiles.length} / {MAX_FILES_PER_BATCH}
                  </p>
                  {submissionFiles.map((file) => (
                    <p key={file.name + file.size} className="text-xs text-slate-500">
                      {file.name}
                    </p>
                  ))}
                </div>
              )}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="secondary"
                disabled={submissionFiles.length === 0 || submissionUploading}
                onClick={uploadSubmissionFiles}
              >
                {submissionUploading
                  ? `Uploading ${submissionUploadCurrent}/${submissionUploadTotal} (${submissionUploadProgress}%)`
                  : `Upload selected files (${submissionFiles.length})`}
              </Button>
              {submissionUploading && (
                <div className="h-2 w-44 overflow-hidden rounded-full bg-slate-200">
                  <div
                    className="h-full rounded-full bg-blue-500 transition-all"
                    style={{ width: `${submissionUploadProgress}%` }}
                  />
                </div>
              )}
            </div>
            {submissionUploadError && (
              <p className="mt-2 text-sm text-rose-700">{submissionUploadError}</p>
            )}
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium text-slate-700">Instructor resources</p>
            {(resourcesQuery.data?.length ?? 0) === 0 && (
              <p className="text-sm text-slate-500">No resources uploaded yet.</p>
            )}
            {resourcesQuery.data?.map((file: any) => (
              <a
                key={file.id}
                className="block rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 underline underline-offset-4"
                href={`/api/attachments/${file.id}/download`}
                target="_blank"
                rel="noreferrer"
              >
                {file.originalName}
              </a>
            ))}
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium text-slate-700">Your uploaded files</p>
            {(submissionAttachmentsQuery.data?.length ?? 0) === 0 && (
              <p className="text-sm text-slate-500">No uploaded files yet.</p>
            )}
            {submissionAttachmentsQuery.data?.map((file: SubmissionAttachmentItem) => (
              <div key={file.id} className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                <a
                  className="text-sm text-slate-700 underline underline-offset-4"
                  href={`/api/attachments/${file.id}/download`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {file.originalName}
                </a>
                <button
                  type="button"
                  className={`h-7 w-7 rounded-full border text-sm font-semibold transition ${
                    canRemoveSubmissionFiles
                      ? 'border-rose-200 text-rose-600 hover:bg-rose-50'
                      : 'cursor-not-allowed border-slate-200 text-slate-300'
                  }`}
                  disabled={!canRemoveSubmissionFiles || removeSubmissionAttachmentMutation.isPending}
                  onClick={() => removeSubmissionAttachmentMutation.mutate(file.id)}
                  aria-label={`Remove ${file.originalName}`}
                  title={
                    canRemoveSubmissionFiles
                      ? 'Remove file'
                      : 'Cannot remove after submission'
                  }
                >
                  x
                </button>
              </div>
            ))}
            {dismissedSubmissionFiles.map((file) => (
              <div
                key={`dismissed-${file.id}`}
                className="flex items-center justify-between gap-2 rounded-lg border border-dashed border-slate-300 bg-white px-3 py-2 text-sm text-slate-500"
              >
                <span className="line-through">{file.originalName}</span>
                <span className="text-xs uppercase tracking-wide text-slate-400">Removed</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card className="space-y-2">
        <h2 className="text-lg font-semibold">AI Coaching</h2>
        <form
          className="space-y-2"
          onSubmit={handleSubmit((values) =>
            coachingMutation.mutate(
              {
                question: values.question,
                studentDraft: isStudent ? answerText : undefined,
              },
              {
                onSuccess: () => reset(),
              },
            ),
          )}
        >
          <Textarea
            rows={4}
            placeholder={isStudent ? 'Ask: Can you help improve my draft answer?' : 'Ask: How can I improve this lesson?'}
            {...register('question')}
          />
          <Button disabled={coachingMutation.isPending} type="submit" variant="secondary">
            {coachingMutation.isPending ? 'Asking AI...' : 'Ask coaching question'}
          </Button>
        </form>
        {(coachingHistoryQuery.data?.length ?? 0) > 0 && (
          <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
            <div className="flex items-center justify-between">
              <p className="text-xs text-slate-500">
                Chat {coachingIndex + 1} of {coachingHistoryQuery.data?.length}
              </p>
              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  className="px-2 py-1 text-xs"
                  disabled={coachingIndex <= 0}
                  onClick={() => setCoachingIndex((value) => Math.max(0, value - 1))}
                >
                  ←
                </Button>
                <Button
                  variant="ghost"
                  className="px-2 py-1 text-xs"
                  disabled={coachingIndex >= (coachingHistoryQuery.data?.length ?? 1) - 1}
                  onClick={() =>
                    setCoachingIndex((value) =>
                      Math.min((coachingHistoryQuery.data?.length ?? 1) - 1, value + 1),
                    )
                  }
                >
                  →
                </Button>
              </div>
            </div>
            <p className="text-sm text-slate-700">
              <span className="font-medium">Q:</span> {activeCoachingMessage?.question}
            </p>
            <p className="whitespace-pre-wrap text-sm text-slate-700">
              <span className="font-medium">A:</span> {activeCoachingMessage?.response}
            </p>
          </div>
        )}
      </Card>

      {!isStudent && (
        <Card className="space-y-3">
          <h2 className="text-lg font-semibold">Student submissions</h2>
          {(contentQuery.data?.submissions?.length ?? 0) === 0 && (
            <EmptyState
              title="No submissions yet"
              description="Students will appear here after submitting their answers."
            />
          )}
          <div className="space-y-3">
            {contentQuery.data?.submissions?.map((submission) => (
              <div key={submission.id} className={`rounded-xl border border-slate-200 bg-slate-50/70 p-4 ${CARD_HOVER_CLASS}`}>
                <div className="flex items-center justify-between gap-2">
                  <p className="font-medium text-slate-900">{submission.student.fullName}</p>
                  <Badge variant={submission.status === 'GRADED' ? 'success' : 'info'}>
                    {formatEnumLabel(submission.status)}
                  </Badge>
                </div>
                <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">{submission.answerText}</p>
                {(submission.attachments?.length ?? 0) > 0 && (
                  <div className="mt-2 space-y-1">
                    <p className="text-xs font-medium text-slate-600">Attachments</p>
                    {submission.attachments?.map((file) => (
                      <a
                        key={file.id}
                        className="block text-sm text-slate-700 underline underline-offset-4"
                        href={`/api/attachments/${file.id}/download`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {file.originalName}
                      </a>
                    ))}
                  </div>
                )}
                <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
                  <Input
                    placeholder="Score (0-100)"
                    value={gradingDraft[submission.id]?.score ?? (submission.score?.toString() ?? '')}
                    onChange={(event) =>
                      setGradingDraft((previous) => ({
                        ...previous,
                        [submission.id]: { ...previous[submission.id], score: event.target.value },
                      }))
                    }
                  />
                  <Input
                    placeholder="Feedback"
                    value={gradingDraft[submission.id]?.feedback ?? (submission.feedback ?? '')}
                    onChange={(event) =>
                      setGradingDraft((previous) => ({
                        ...previous,
                        [submission.id]: { ...previous[submission.id], feedback: event.target.value },
                      }))
                    }
                  />
                </div>
                <div className="mt-2">
                  <Button
                    variant="secondary"
                    disabled={gradeSubmissionMutation.isPending}
                    onClick={() =>
                      gradeSubmissionMutation.mutate({
                        submissionId: submission.id,
                        score: gradingDraft[submission.id]?.score
                          ? Number(gradingDraft[submission.id]?.score)
                          : submission.score,
                        feedback: gradingDraft[submission.id]?.feedback ?? submission.feedback,
                      })
                    }
                  >
                    {gradeSubmissionMutation.isPending ? 'Saving grade...' : 'Save grade'}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {canEditContent && (
        <ConfirmModal
          open={openDeleteContentModal}
          title="Delete content item"
          description="This will permanently delete this content item, all AI reviews, and coaching history."
          confirmLabel="Delete content item"
          confirmVariant="danger"
          busy={deleteContentMutation.isPending}
          onCancel={() => setOpenDeleteContentModal(false)}
          onConfirm={() => {
            deleteContentMutation.mutate(undefined, {
              onSettled: () => setOpenDeleteContentModal(false),
            })
          }}
        />
      )}
    </div>
  )
}
