import { useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/authContext'
import { getErrorMessage } from '../services/api'

function dashboardPath(role: 'BUYER' | 'SELLER' | 'ADMIN') {
  return role === 'SELLER' ? '/seller' : role === 'ADMIN' ? '/admin' : '/dashboard'
}

export function LoginPage() {
  const { user, login } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  if (user) return <Navigate to={dashboardPath(user.role)} replace />

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      const signedIn = await login(email.trim(), password)
      navigate(dashboardPath(signedIn.role), { replace: true })
    } catch (requestError: unknown) {
      setError(getErrorMessage(requestError, 'Unable to sign in. Please check your details and try again.'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="auth-wrap">
      <section className="auth-card">
        <span className="eyebrow">Welcome back</span>
        <h1>Sign in to SmartEstate</h1>
        <p>Pick up where your home search left off.</p>
        <form className="auth-form" onSubmit={submit}>
          {error && <div className="error-box" role="alert">{error}</div>}
          <div className="field"><label htmlFor="email">Email address</label><input id="email" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></div>
          <div className="field"><label htmlFor="password">Password</label><input id="password" type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} /></div>
          <button className="btn btn-primary" type="submit" disabled={submitting}>{submitting ? 'Signing in…' : 'Sign in'}</button>
        </form>
        <div className="auth-switch">New to SmartEstate? <Link to="/register">Create an account</Link></div>
      </section>
    </main>
  )
}
