// thin wrappers around REST paths so pages do not repeat axios boilerplate

import { http } from './http'

type UploadProgressHandler = (percent: number) => void

export const apiClient = {
  login: (payload: { email: string; password: string }) =>
    http.post('/auth/login', payload).then((response) => response.data),
  me: () => http.get('/auth/me').then((response) => response.data),
  dashboardOverview: () =>
    http.get('/dashboard/overview').then((response) => response.data),
  studentCourses: () => http.get('/courses/my-enrollments').then((response) => response.data),
  listCourses: () => http.get('/courses').then((response) => response.data),
  createCourse: (payload: { title: string; description?: string; backgroundImage?: string }) =>
    http.post('/courses', payload).then((response) => response.data),
  updateCourse: (courseId: string, payload: { title?: string; description?: string; backgroundImage?: string }) =>
    http.patch(`/courses/${courseId}`, payload).then((response) => response.data),
  deleteCourse: (courseId: string, payload: { confirmTitle: string }) =>
    http.delete(`/courses/${courseId}`, { data: payload }).then((response) => response.data),
  getCourse: (courseId: string) =>
    http.get(`/courses/${courseId}`).then((response) => response.data),
  createModule: (
    courseId: string,
    payload: { title: string; description?: string; learningOutcomes?: string },
  ) => http.post(`/courses/${courseId}/modules`, payload).then((response) => response.data),
  updateModule: (
    moduleId: string,
    payload: { title?: string; description?: string; learningOutcomes?: string },
  ) => http.patch(`/modules/${moduleId}`, payload).then((response) => response.data),
  deleteModule: (moduleId: string) =>
    http.delete(`/modules/${moduleId}`).then((response) => response.data),
  getModule: (moduleId: string) =>
    http.get(`/modules/${moduleId}`).then((response) => response.data),
  createContentItem: (
    moduleId: string,
    payload: { title: string; contentType: string; body: string; rubricText?: string; dueAt?: string },
  ) => http.post(`/modules/${moduleId}/content-items`, payload).then((response) => response.data),
  uploadContentResource: (
    contentId: string,
    file: File,
    onProgress?: UploadProgressHandler,
  ) => {
    const formData = new FormData()
    formData.append('file', file)
    return http
      .post(`/content-items/${contentId}/resources`, formData, {
        onUploadProgress: (event) => {
          if (!onProgress || !event.total) return
          onProgress(Math.round((event.loaded / event.total) * 100))
        },
      })
      .then((response) => response.data)
  },
  listContentResources: (contentId: string) =>
    http.get(`/content-items/${contentId}/resources`).then((response) => response.data),
  removeContentResource: (contentId: string, attachmentId: string) =>
    http.delete(`/content-items/${contentId}/resources/${attachmentId}`).then((response) => response.data),
  getContentItem: (contentId: string) =>
    http.get(`/content-items/${contentId}`).then((response) => response.data),
  updateContentItem: (
    contentId: string,
    payload: { title?: string; contentType?: string; body?: string; rubricText?: string; dueAt?: string; status?: string },
  ) => http.patch(`/content-items/${contentId}`, payload).then((response) => response.data),
  deleteContentItem: (contentId: string) =>
    http.delete(`/content-items/${contentId}`).then((response) => response.data),
  submitStudentAnswer: (contentId: string, payload: { answerText: string }) =>
    http.post(`/content-items/${contentId}/submissions`, payload).then((response) => response.data),
  uploadSubmissionAttachment: (
    contentId: string,
    file: File,
    onProgress?: UploadProgressHandler,
  ) => {
    const formData = new FormData()
    formData.append('file', file)
    return http
      .post(`/content-items/${contentId}/submissions/attachments`, formData, {
        onUploadProgress: (event) => {
          if (!onProgress || !event.total) return
          onProgress(Math.round((event.loaded / event.total) * 100))
        },
      })
      .then((response) => response.data)
  },
  listMySubmissionAttachments: (contentId: string) =>
    http.get(`/content-items/${contentId}/submissions/my/attachments`).then((response) => response.data),
  removeMySubmissionAttachment: (contentId: string, attachmentId: string) =>
    http
      .delete(`/content-items/${contentId}/submissions/attachments/${attachmentId}`)
      .then((response) => response.data),
  saveStudentAnswerDraft: (contentId: string, payload: { answerText: string }) =>
    http.patch(`/content-items/${contentId}/submissions/draft`, payload).then((response) => response.data),
  listMySubmissions: () =>
    http.get('/students/me/submissions').then((response) => response.data),
  gradeSubmission: (
    submissionId: string,
    payload: { score?: number; feedback?: string },
  ) => http.patch(`/submissions/${submissionId}/grade`, payload).then((response) => response.data),
  coachingChat: (contentId: string, payload: { question: string; studentDraft?: string }) =>
    http
      .post(`/ai/coaching/content-items/${contentId}/chat`, payload)
      .then((response) => response.data),
  coachingHistory: (contentId: string) =>
    http.get(`/ai/coaching/content-items/${contentId}/history`).then((response) => response.data),
  studentGuidance: (contentId: string, payload: { question: string }) =>
    http
      .post(`/ai/student-guidance/content-items/${contentId}`, payload)
      .then((response) => response.data),
  listUsers: () => http.get('/users').then((response) => response.data),
  createUser: (payload: { email: string; fullName: string; password: string; role: string }) =>
    http.post('/users', payload).then((response) => response.data),
  listStudentEnrollments: (userId: string) =>
    http.get(`/users/${userId}/enrollments`).then((response) => response.data),
  addStudentEnrollment: (userId: string, payload: { courseId: string }) =>
    http.patch(`/users/${userId}/enrollments/add`, payload).then((response) => response.data),
  removeStudentEnrollment: (userId: string, payload: { courseId: string }) =>
    http.patch(`/users/${userId}/enrollments/remove`, payload).then((response) => response.data),
  deleteUser: (userId: string, payload: { confirmFullName: string }) =>
    http.delete(`/users/${userId}`, { data: payload }).then((response) => response.data),
}
