import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import type { ReactNode } from 'react'
import { AuthProvider } from './hooks/useAuth'
import { useAuth } from './hooks/authContext'
import { ToastContainer } from './components/Toast'
import { SiteLayout } from './components/SiteLayout'
import { Spinner } from './components/Spinner'
import { AdminDashboard } from './pages/AdminDashboard'
import { BuyerDashboard } from './pages/BuyerDashboard'
import { HomePage } from './pages/HomePage'
import { LoginPage } from './pages/LoginPage'
import { PropertyDetailsPage } from './pages/PropertyDetailsPage'
import { RegisterPage } from './pages/RegisterPage'
import { SellerDashboard } from './pages/SellerDashboard'

function DashboardRedirect() {
  const { user } = useAuth()
  if (user?.role === 'SELLER') return <Navigate to="/seller" replace />
  if (user?.role === 'ADMIN') return <Navigate to="/admin" replace />
  return <Navigate to="/dashboard" replace />
}

function ProtectedRoute({ allowedRole, children }: { allowedRole?: 'BUYER' | 'SELLER' | 'ADMIN'; children: ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) return <Spinner label="Checking your session" />
  if (!user) return <Navigate to="/login" replace />
  if (allowedRole && user.role !== allowedRole) return <DashboardRedirect />
  return children
}

function AppRoutes() {
  return (
    <>
      <Routes>
        <Route element={<SiteLayout />}>
          <Route path="/" element={<HomePage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/properties/:id" element={<PropertyDetailsPage />} />
          <Route path="/dashboard" element={<ProtectedRoute allowedRole="BUYER"><BuyerDashboard /></ProtectedRoute>} />
          <Route path="/seller" element={<ProtectedRoute allowedRole="SELLER"><SellerDashboard /></ProtectedRoute>} />
          <Route path="/admin" element={<ProtectedRoute allowedRole="ADMIN"><AdminDashboard /></ProtectedRoute>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
      <ToastContainer />
    </>
  )
}

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  )
}

export default App
