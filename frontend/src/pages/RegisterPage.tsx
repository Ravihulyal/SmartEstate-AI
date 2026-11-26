import { useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/authContext'
import { getErrorMessage } from '../services/api'
import { notify } from '../services/toast'

export function RegisterPage() {
  const { user, register, login } = useAuth()
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<'BUYER' | 'SELLER'>('BUYER')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  if (user) return <Navigate to={user.role === 'SELLER' ? '/seller' : user.role === 'ADMIN' ? '/admin' : '/dashboard'} replace />

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      await register(name.trim(), email.trim(), password, role)
      await login(email.trim(), password)
      notify('Your SmartEstate account is ready.')
      navigate(role === 'SELLER' ? '/seller' : '/dashboard', { replace: true })
    } catch (requestError: unknown) {
      setError(getErrorMessage(requestError, 'Registration could not be completed. Please try again.'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="auth-wrap">
      <section className="auth-card">
        <span className="eyebrow">Make your next move</span>
        <h1>Create an account</h1>
        <p>Join SmartEstate to explore homes or list a property.</p>
        <form className="auth-form" onSubmit={submit}>
          {error && <div className="error-box" role="alert">{error}</div>}
          <div className="field"><label htmlFor="name">Full name</label><input id="name" autoComplete="name" minLength={2} maxLength={100} required value={name} onChange={(event) => setName(event.target.value)} /></div>
          <div className="field"><label htmlFor="email">Email address</label><input id="email" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></div>
          <div className="field"><label htmlFor="password">Password</label><input id="password" type="password" autoComplete="new-password" minLength={8} maxLength={72} required value={password} onChange={(event) => setPassword(event.target.value)} /><span className="label-note">Use at least 8 characters.</span></div>
          <div className="field"><label htmlFor="role">I want to</label><select id="role" value={role} onChange={(event) => setRole(event.target.value as 'BUYER' | 'SELLER')}><option value="BUYER">Find a home (Buyer)</option><option value="SELLER">List a property (Seller)</option></select></div>
          <button className="btn btn-primary" type="submit" disabled={submitting}>{submitting ? 'Creating account…' : 'Create account'}</button>
        </form>
        <div className="auth-switch">Already have an account? <Link to="/login">Sign in</Link></div>
      </section>
    </main>
  )
}
