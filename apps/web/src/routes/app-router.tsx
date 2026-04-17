// declares LMS routes; admin-only paths sit inside AdminRoute

import { Navigate, Route, Routes } from 'react-router-dom'
import { LoginPage } from '../pages/login-page'
import { ProtectedRoute } from './protected-route'
import { AppLayout } from '../layouts/app-layout'
import { DashboardPage } from '../pages/dashboard-page'
import { CoursesPage } from '../pages/courses-page'
import { CourseDetailPage } from '../pages/course-detail-page'
import { ModuleDetailPage } from '../pages/module-detail-page'
import { ContentItemPage } from '../pages/content-item-page'
import { AdminUsersPage } from '../pages/admin-users-page'
import { MyLearningPage } from '../pages/my-learning-page'
import { AdminRoute } from './admin-route'

export function AppRouter() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      <Route element={<ProtectedRoute />}>
        <Route element={<AppLayout />}>
          <Route path="/" element={<Navigate replace to="/dashboard" />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/my-learning" element={<MyLearningPage />} />
          <Route path="/courses" element={<CoursesPage />} />
          <Route path="/courses/:courseId" element={<CourseDetailPage />} />
          <Route path="/modules/:moduleId" element={<ModuleDetailPage />} />
          <Route path="/content-items/:contentId" element={<ContentItemPage />} />
          <Route element={<AdminRoute />}>
            <Route path="/admin/users" element={<AdminUsersPage />} />
          </Route>
        </Route>
      </Route>
    </Routes>
  )
}
