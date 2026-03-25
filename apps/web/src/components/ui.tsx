// goal: reusable layout primitives (buttons, cards, modal) with Tailwind classes.

import type React from 'react'
import { useEffect, useState } from 'react'
import type { PropsWithChildren } from 'react'

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'warning' | 'ghost'
export const CARD_HOVER_CLASS =
  'hover:-translate-y-1 hover:border-slate-300 hover:shadow-lg hover:shadow-slate-200/80'

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
}

// central place to tweak button colors without touching every screen
const buttonVariantMap: Record<ButtonVariant, string> = {
  primary: 'bg-slate-900 text-white hover:bg-slate-700',
  secondary: 'bg-slate-100 text-slate-700 hover:bg-slate-200',
  danger: 'bg-rose-700 text-white hover:bg-rose-600',
  warning: 'bg-amber-700 text-white hover:bg-amber-600',
  ghost: 'bg-white text-slate-700 hover:bg-slate-50 border border-slate-300',
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string
  description?: string
  actions?: React.ReactNode
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900 md:text-3xl">{title}</h1>
        {description && <p className="max-w-3xl text-sm text-slate-500">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  )
}

export function Card({
  children,
  className = '',
  ...props
}: PropsWithChildren<React.HTMLAttributes<HTMLDivElement>>) {
  return (
    <div
      {...props}
      className={`rounded-2xl border border-slate-200/70 bg-white p-5 shadow-sm shadow-slate-200/60 backdrop-blur ${className}`}
    >
      {children}
    </div>
  )
}

export function Badge({
  children,
  variant = 'neutral',
}: PropsWithChildren<{ variant?: 'neutral' | 'success' | 'warning' | 'danger' | 'info' }>) {
  const styles: Record<string, string> = {
    neutral: 'border-slate-200 bg-slate-100 text-slate-700',
    success: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    warning: 'border-amber-200 bg-amber-50 text-amber-700',
    danger: 'border-rose-200 bg-rose-50 text-rose-700',
    info: 'border-blue-200 bg-blue-50 text-blue-700',
  }
  return (
    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${styles[variant]}`}>
      {children}
    </span>
  )
}

export function EmptyState({
  title,
  description,
}: {
  title: string
  description: string
}) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center">
      <p className="text-base font-semibold text-slate-800">{title}</p>
      <p className="mt-2 text-sm text-slate-500">{description}</p>
    </div>
  )
}

export function Button({ variant = 'primary', className = '', ...props }: ButtonProps) {
  return (
    <button
      {...props}
      className={`inline-flex items-center justify-center rounded-xl px-4 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-60 ${buttonVariantMap[variant]} ${className}`}
    />
  )
}

export function Modal({
  open,
  title,
  description,
  children,
  onClose,
  showHeaderClose = false,
}: PropsWithChildren<{
  open: boolean
  title: string
  description?: string
  onClose: () => void
  showHeaderClose?: boolean
}>) {
  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4">
      <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-5 shadow-xl">
        <div className="space-y-1">
          <div className="flex items-start justify-between gap-2">
            <p className="text-lg font-semibold text-slate-900">{title}</p>
            {showHeaderClose && (
              <Button variant="ghost" className="px-2 py-1 text-xs" onClick={onClose}>
                X
              </Button>
            )}
          </div>
          {description && <p className="text-sm text-slate-500">{description}</p>}
        </div>
        <div className="mt-4">{children}</div>
      </div>
    </div>
  )
}

export function ConfirmModal({
  open,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  confirmVariant = 'primary',
  busy = false,
  onCancel,
  onConfirm,
}: {
  open: boolean
  title: string
  description?: string
  confirmLabel?: string
  cancelLabel?: string
  confirmVariant?: ButtonVariant
  busy?: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <Modal open={open} title={title} description={description} onClose={onCancel}>
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="ghost" onClick={onCancel} disabled={busy}>
          {cancelLabel}
        </Button>
        <Button variant={confirmVariant} onClick={onConfirm} disabled={busy}>
          {busy ? 'Working...' : confirmLabel}
        </Button>
      </div>
    </Modal>
  )
}

export function TypedConfirmModal({
  open,
  title,
  description,
  expectedText,
  inputLabel,
  confirmLabel = 'Delete',
  busy = false,
  onCancel,
  onConfirm,
}: {
  open: boolean
  title: string
  description?: string
  expectedText: string
  inputLabel: string
  confirmLabel?: string
  busy?: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  const [typedValue, setTypedValue] = useState('')

  useEffect(() => {
    if (!open) setTypedValue('')
  }, [open])

  const canConfirm = typedValue === expectedText

  return (
    <Modal open={open} title={title} description={description} onClose={onCancel}>
      <div className="space-y-3">
        <p className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
          Type exactly: <span className="font-semibold">{expectedText}</span>
        </p>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">{inputLabel}</label>
          <Input
            value={typedValue}
            onChange={(event) => setTypedValue(event.target.value)}
            placeholder="Type confirmation text"
          />
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={onConfirm}
            disabled={busy || !canConfirm}
          >
            {busy ? 'Deleting...' : confirmLabel}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-700 outline-none transition placeholder:text-slate-400 focus:border-slate-500 focus:ring-2 focus:ring-slate-200 ${props.className ?? ''}`}
    />
  )
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={`w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-700 outline-none transition placeholder:text-slate-400 focus:border-slate-500 focus:ring-2 focus:ring-slate-200 ${props.className ?? ''}`}
    />
  )
}
