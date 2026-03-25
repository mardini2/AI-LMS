// goal: read one AI review run and let staff submit a human approval decision.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { apiClient } from '../api/client'
import { Badge, Button, Card, ConfirmModal, EmptyState, PageHeader, Textarea } from '../components/ui'
import { useState } from 'react'
import { formatEnumLabel } from '../utils/format-enum-label'

interface AgentReview {
  id: string
  agentType: string
  findings: string
  confidenceLabel?: string
  suggestedActions?: string
}

interface ReviewResult {
  id: string
  status: string
  contentItem?: {
    id: string
    title: string
  }
  finalSummary?: {
    summaryText: string
    qualityScore?: number
    confidenceLabel?: string
    suggestedAction?: string
  }
  agentReviews: AgentReview[]
}

export function ReviewResultPage() {
  const { reviewRequestId = '' } = useParams()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [notes, setNotes] = useState('')
  const [decisionFeedback, setDecisionFeedback] = useState<string | null>(null)
  const [pendingDecision, setPendingDecision] = useState<
    'APPROVED' | 'NEEDS_REVISION' | 'REJECTED' | null
  >(null)

  const reviewQuery = useQuery<ReviewResult>({
    queryKey: ['review', reviewRequestId],
    queryFn: () => apiClient.getReview(reviewRequestId),
    enabled: Boolean(reviewRequestId),
  })

  const decisionMutation = useMutation({
    mutationFn: (decision: 'APPROVED' | 'NEEDS_REVISION' | 'REJECTED') =>
      apiClient.setReviewDecision(reviewRequestId, { decision, notes }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['review', reviewRequestId] })
      setDecisionFeedback('Decision saved successfully.')
    },
  })

  const runDecision = (decision: 'APPROVED' | 'NEEDS_REVISION' | 'REJECTED') => {
    setPendingDecision(decision)
    setDecisionFeedback(null)
  }

  const decisionLabel =
    pendingDecision === 'APPROVED'
      ? 'Approve'
      : pendingDecision === 'NEEDS_REVISION'
        ? 'Needs revision'
        : pendingDecision === 'REJECTED'
          ? 'Reject'
          : ''

  return (
    <div className="space-y-6">
      <PageHeader
        title="Review Result"
        description="Analyze each agent finding, then submit a final human quality decision."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="ghost"
              onClick={() => {
                const contentId = reviewQuery.data?.contentItem?.id
                if (contentId) {
                  navigate(`/content-items/${contentId}`)
                  return
                }
                navigate('/courses')
              }}
            >
              Back
            </Button>
            {reviewQuery.data?.contentItem?.id && (
              <Link
                to={`/content-items/${reviewQuery.data.contentItem.id}`}
                target="_blank"
                rel="noreferrer"
              >
                <Button variant="secondary">Open content in new tab</Button>
              </Link>
            )}
            <Badge variant={reviewQuery.data?.status === 'COMPLETED' ? 'success' : reviewQuery.data?.status === 'FAILED' ? 'danger' : 'warning'}>
              {formatEnumLabel(reviewQuery.data?.status, 'Pending')}
            </Badge>
          </div>
        }
      />

      <Card className="space-y-2">
        <p className="mt-2 whitespace-pre-wrap text-sm">{reviewQuery.data?.finalSummary?.summaryText}</p>
        <p className="mt-2 text-sm text-slate-600">
          Quality score: {reviewQuery.data?.finalSummary?.qualityScore ?? 'N/A'} · Confidence:{' '}
          {reviewQuery.data?.finalSummary?.confidenceLabel ?? 'N/A'}
        </p>
      </Card>

      {(reviewQuery.data?.agentReviews.length ?? 0) === 0 && (
        <EmptyState
          title="No agent reviews found"
          description="If this was just requested, wait for processing and refresh."
        />
      )}

      <div className="space-y-3">
        {reviewQuery.data?.agentReviews.map((agentReview) => (
          <Card key={agentReview.id} className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <p className="font-semibold text-slate-900">{agentReview.agentType}</p>
              <Badge
                variant={
                  agentReview.confidenceLabel === 'HIGH'
                    ? 'success'
                    : agentReview.confidenceLabel === 'LOW'
                      ? 'danger'
                      : 'warning'
                }
              >
                Confidence {agentReview.confidenceLabel ?? 'N/A'}
              </Badge>
            </div>
            <p className="whitespace-pre-wrap text-sm">{agentReview.findings}</p>
            <p className="mt-2 text-xs text-slate-600">
              Suggested action: {agentReview.suggestedActions ?? 'N/A'}
            </p>
          </Card>
        ))}
      </div>

      <Card className="space-y-3">
        <h2 className="text-lg font-semibold">Human decision</h2>
        <Textarea
          rows={3}
          placeholder="Optional notes for the final decision."
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
        />
        <div className="flex flex-wrap gap-2">
          <Button disabled={decisionMutation.isPending} onClick={() => runDecision('APPROVED')}>
            Approve
          </Button>
          <Button
            variant="warning"
            disabled={decisionMutation.isPending}
            onClick={() => runDecision('NEEDS_REVISION')}
          >
            Needs revision
          </Button>
          <Button
            variant="danger"
            disabled={decisionMutation.isPending}
            onClick={() => runDecision('REJECTED')}
          >
            Reject
          </Button>
        </div>
        {decisionMutation.isError && (
          <p className="text-sm text-rose-700">Decision failed to save. Please try again.</p>
        )}
        {decisionFeedback && <p className="text-sm text-emerald-700">{decisionFeedback}</p>}
      </Card>

      <ConfirmModal
        open={pendingDecision !== null}
        title="Confirm decision"
        description={
          pendingDecision
            ? `Are you sure you want to mark this review as "${decisionLabel}"?`
            : undefined
        }
        confirmLabel={decisionLabel || 'Confirm'}
        confirmVariant={
          pendingDecision === 'REJECTED'
            ? 'danger'
            : pendingDecision === 'NEEDS_REVISION'
              ? 'warning'
              : 'primary'
        }
        busy={decisionMutation.isPending}
        onCancel={() => setPendingDecision(null)}
        onConfirm={() => {
          if (!pendingDecision) return
          decisionMutation.mutate(pendingDecision, {
            onSettled: () => setPendingDecision(null),
          })
        }}
      />
    </div>
  )
}
