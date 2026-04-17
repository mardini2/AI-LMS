// goal: guard apiClient wiring: paths, delete payloads, timeouts, and upload progress.

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./http', () => ({
  http: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}))

import { apiClient } from './client'
import { http } from './http'

describe('apiClient', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('calls listCourses with the expected endpoint', async () => {
    vi.mocked(http.get).mockResolvedValue({ data: [{ id: 'c1' }] })

    await expect(apiClient.listCourses()).resolves.toEqual([{ id: 'c1' }])
    expect(http.get).toHaveBeenCalledWith('/courses')
  })

  it('calls deleteCourse with payload in request body', async () => {
    vi.mocked(http.delete).mockResolvedValue({ data: { deleted: true } })

    await expect(
      apiClient.deleteCourse('c1', { confirmTitle: 'Intro' }),
    ).resolves.toEqual({ deleted: true })
    expect(http.delete).toHaveBeenCalledWith('/courses/c1', {
      data: { confirmTitle: 'Intro' },
    })
  })

  it('calls studentGuidance with the expected path', async () => {
    vi.mocked(http.post).mockResolvedValue({ data: { response: 'ok' } })

    await expect(
      apiClient.studentGuidance('content-1', { question: 'What is this task?' }),
    ).resolves.toEqual({ response: 'ok' })
    expect(http.post).toHaveBeenCalledWith('/ai/student-guidance/content-items/content-1', {
      question: 'What is this task?',
    })
  })

  it('reports upload progress as percentage for content resource upload', async () => {
    vi.mocked(http.post).mockImplementation((_url, _formData, config) => {
      config?.onUploadProgress?.({
        loaded: 35,
        total: 100,
        bytes: 35,
        lengthComputable: true,
      })
      return Promise.resolve({ data: { ok: true } })
    })
    const onProgress = vi.fn()
    const file = new File(['hello'], 'note.txt', { type: 'text/plain' })

    await expect(
      apiClient.uploadContentResource('content-1', file, onProgress),
    ).resolves.toEqual({ ok: true })
    expect(onProgress).toHaveBeenCalledWith(35)
  })
})
