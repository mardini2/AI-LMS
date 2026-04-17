// goal: admin-only user list with create, delete, and student enrollment tools.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { apiClient } from '../api/client'
import { Badge, Button, CARD_HOVER_CLASS, Card, ConfirmModal, EmptyState, Input, Modal, PageHeader, TypedConfirmModal } from '../components/ui'

interface AdminUser {
  id: string
  fullName: string
  email: string
  role: string
}

export function AdminUsersPage() {
  const queryClient = useQueryClient()
  const [selectedUser, setSelectedUser] = useState<AdminUser | null>(null)
  const [selectedCourseId, setSelectedCourseId] = useState('')
  const [pendingRemoveCourseId, setPendingRemoveCourseId] = useState<string | null>(null)
  const [openDeleteUserModal, setOpenDeleteUserModal] = useState(false)
  const [openCreateUserModal, setOpenCreateUserModal] = useState(false)
  const [newUser, setNewUser] = useState({
    fullName: '',
    email: '',
    password: '',
    role: 'INSTRUCTOR',
  })

  const usersQuery = useQuery<AdminUser[]>({
    queryKey: ['users'],
    queryFn: apiClient.listUsers,
  })

  const coursesQuery = useQuery({
    queryKey: ['courses'],
    queryFn: apiClient.listCourses,
  })

  const studentEnrollmentsQuery = useQuery({
    queryKey: ['users', selectedUser?.id, 'enrollments'],
    queryFn: () => apiClient.listStudentEnrollments(selectedUser!.id),
    enabled: Boolean(selectedUser?.id && selectedUser.role === 'STUDENT'),
  })

  const addEnrollmentMutation = useMutation({
    mutationFn: (courseId: string) =>
      apiClient.addStudentEnrollment(selectedUser!.id, { courseId }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['users', selectedUser?.id, 'enrollments'] })
      setSelectedCourseId('')
    },
  })

  const removeEnrollmentMutation = useMutation({
    mutationFn: (courseId: string) =>
      apiClient.removeStudentEnrollment(selectedUser!.id, { courseId }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['users', selectedUser?.id, 'enrollments'] })
    },
  })

  const deleteUserMutation = useMutation({
    mutationFn: (confirmFullName: string) =>
      apiClient.deleteUser(selectedUser!.id, { confirmFullName }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['users'] })
      setSelectedUser(null)
      setOpenDeleteUserModal(false)
    },
  })

  const createUserMutation = useMutation({
    mutationFn: () => apiClient.createUser(newUser),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['users'] })
      setOpenCreateUserModal(false)
      setNewUser({ fullName: '', email: '', password: '', role: 'INSTRUCTOR' })
    },
  })

  return (
    <div className="space-y-6">
      <PageHeader
        title="User management"
        description="Review role assignments for platform governance and permission controls."
        actions={
          <Button variant="primary" onClick={() => setOpenCreateUserModal(true)}>
            Add user
          </Button>
        }
      />

      {!usersQuery.isLoading && (usersQuery.data?.length ?? 0) === 0 && (
        <EmptyState title="No users found" description="Run the database seed or create accounts below." />
      )}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {usersQuery.data?.map((user) => (
          <Card
            key={user.id}
            className={`space-y-2 cursor-pointer transition duration-200 ${CARD_HOVER_CLASS}`}
            onClick={() => {
              setSelectedUser(user)
            }}
          >
            <div className="flex items-center justify-between gap-2">
              <p className="font-semibold text-slate-900">{user.fullName}</p>
              <Badge
                variant={
                  user.role === 'ADMIN'
                    ? 'danger'
                    : user.role === 'INSTRUCTOR'
                      ? 'info'
                      : user.role === 'REVIEWER'
                        ? 'warning'
                        : 'neutral'
                }
              >
                {user.role}
              </Badge>
            </div>
            <p className="text-sm text-slate-500">{user.email}</p>
          </Card>
        ))}
      </div>

      <Modal
        open={Boolean(selectedUser)}
        title={
          selectedUser?.role === 'STUDENT'
            ? `Manage courses for ${selectedUser.fullName}`
            : selectedUser
              ? `Manage user: ${selectedUser.fullName}`
              : 'Manage user'
        }
        description={
          selectedUser?.role === 'STUDENT'
            ? 'Add or remove this student from available courses.'
            : 'Review account details.'
        }
        onClose={() => {
          setSelectedUser(null)
          setSelectedCourseId('')
        }}
        showHeaderClose
      >
        <div className="space-y-4">
          {selectedUser && (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-sm font-medium text-slate-900">{selectedUser.fullName}</p>
              <p className="text-xs text-slate-600">{selectedUser.email}</p>
              <p className="mt-1 text-xs text-slate-500">Role: {selectedUser.role}</p>
            </div>
          )}

          {selectedUser?.role === 'STUDENT' && (
            <>
          <div className="flex flex-wrap items-center gap-2">
            <select
              className="min-w-[260px] rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-700 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
              value={selectedCourseId}
              onChange={(event) => setSelectedCourseId(event.target.value)}
            >
              <option value="">Select course</option>
              {(coursesQuery.data ?? []).map((course: any) => (
                <option key={course.id} value={course.id}>
                  {course.title}
                </option>
              ))}
            </select>
            <Button
              variant="secondary"
              disabled={!selectedCourseId || addEnrollmentMutation.isPending || !selectedUser}
              onClick={() => addEnrollmentMutation.mutate(selectedCourseId)}
            >
              {addEnrollmentMutation.isPending ? 'Adding...' : 'Add course'}
            </Button>
          </div>
          <div className="space-y-2">
            {(studentEnrollmentsQuery.data ?? []).map((enrollment: any) => (
              <div key={enrollment.id} className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                <p className="text-sm text-slate-700">{enrollment.course.title}</p>
                <Button
                  variant="ghost"
                  className="text-xs"
                  disabled={removeEnrollmentMutation.isPending}
                  onClick={() => setPendingRemoveCourseId(enrollment.courseId)}
                >
                  Remove
                </Button>
              </div>
            ))}
            {(studentEnrollmentsQuery.data?.length ?? 0) === 0 && (
              <p className="text-sm text-slate-500">This student is not assigned to any course yet.</p>
            )}
          </div>
            </>
          )}

          {(selectedUser?.role === 'INSTRUCTOR' || selectedUser?.role === 'REVIEWER') && (
            <p className="text-sm text-slate-500">
              You can remove this account if needed. All linked records are cleaned up automatically.
            </p>
          )}

          {selectedUser?.role !== 'ADMIN' && (
            <div className="flex justify-end">
              <Button
                variant="danger"
                onClick={() => setOpenDeleteUserModal(true)}
                disabled={deleteUserMutation.isPending}
              >
                {deleteUserMutation.isPending ? 'Removing...' : 'Remove user'}
              </Button>
            </div>
          )}
        </div>
      </Modal>

      <ConfirmModal
        open={Boolean(pendingRemoveCourseId)}
        title="Remove student from course?"
        description="This will remove the student from the selected course."
        confirmLabel="Yes, remove"
        confirmVariant="danger"
        busy={removeEnrollmentMutation.isPending}
        onCancel={() => setPendingRemoveCourseId(null)}
        onConfirm={() => {
          if (!pendingRemoveCourseId) return
          removeEnrollmentMutation.mutate(pendingRemoveCourseId, {
            onSettled: () => setPendingRemoveCourseId(null),
          })
        }}
      />

      <Modal
        open={openCreateUserModal}
        title="Create new user"
        description="Add an instructor, reviewer, student, or admin account."
        onClose={() => setOpenCreateUserModal(false)}
      >
        <div className="space-y-3">
          <Input
            placeholder="Full name"
            value={newUser.fullName}
            onChange={(event) => setNewUser((previous) => ({ ...previous, fullName: event.target.value }))}
          />
          <Input
            placeholder="Email"
            value={newUser.email}
            onChange={(event) => setNewUser((previous) => ({ ...previous, email: event.target.value }))}
          />
          <Input
            type="password"
            placeholder="Password (min 8 chars)"
            value={newUser.password}
            onChange={(event) => setNewUser((previous) => ({ ...previous, password: event.target.value }))}
          />
          <select
            className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-700 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
            value={newUser.role}
            onChange={(event) => setNewUser((previous) => ({ ...previous, role: event.target.value }))}
          >
            <option value="INSTRUCTOR">INSTRUCTOR</option>
            <option value="REVIEWER">REVIEWER</option>
            <option value="STUDENT">STUDENT</option>
            <option value="ADMIN">ADMIN</option>
          </select>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              disabled={createUserMutation.isPending}
              onClick={() => createUserMutation.mutate()}
            >
              {createUserMutation.isPending ? 'Creating...' : 'Create user'}
            </Button>
            <Button variant="ghost" onClick={() => setOpenCreateUserModal(false)}>
              Cancel
            </Button>
          </div>
        </div>
      </Modal>

      <TypedConfirmModal
        open={openDeleteUserModal}
        title="Remove user account"
        description="This action permanently removes the account and linked records."
        expectedText={selectedUser?.fullName ?? ''}
        inputLabel="Type the user full name to confirm"
        confirmLabel="Remove user"
        busy={deleteUserMutation.isPending}
        onCancel={() => setOpenDeleteUserModal(false)}
        onConfirm={() => {
          if (!selectedUser) return
          deleteUserMutation.mutate(selectedUser.fullName)
        }}
      />
    </div>
  )
}
