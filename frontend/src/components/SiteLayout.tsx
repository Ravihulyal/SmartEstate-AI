import { useState } from 'react'
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom'
import { Building2, Menu, X } from 'lucide-react'
import { useAuth } from '../hooks/authContext'

export function SiteLayout() {
  const [menuOpen, setMenuOpen] = useState(false)
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const dashboardPath = user?.role === 'SELLER' ? '/seller' : user?.role === 'ADMIN' ? '/admin' : '/dashboard'
  const workflowLink = user?.role === 'BUYER'
    ? { to: '/dashboard#payments', label: 'My payments' }
    : user?.role === 'SELLER'
      ? { to: '/seller#closings', label: 'Payment & closings' }
      : user?.role === 'ADMIN'
        ? { to: '/admin#transactions', label: 'Transactions' }
        : null

  function signOut() {
    logout()
    setMenuOpen(false)
    navigate('/')
  }

  return (
    <div className="site-shell">
      <header className="topbar">
        <div className="nav-inner">
          <Link className="brand" to="/" aria-label="SmartEstate home">
            <span className="brand-mark"><Building2 size={19} /></span>
            <span>smartestate<span style={{ color: '#78927f' }}>.</span></span>
          </Link>
          <nav className={`nav-links ${menuOpen ? 'nav-links-open' : ''}`} aria-label="Main navigation">
            <NavLink to="/" onClick={() => setMenuOpen(false)}>Home</NavLink>
            <a href="/#discover" onClick={() => setMenuOpen(false)}>Discover homes</a>
            <NavLink to="/auctions" onClick={() => setMenuOpen(false)}>Auctions</NavLink>
            {user && <NavLink to={dashboardPath} onClick={() => setMenuOpen(false)}>Dashboard</NavLink>}
            {workflowLink && <NavLink to={workflowLink.to} onClick={() => setMenuOpen(false)}>{workflowLink.label}</NavLink>}
            {user?.role === 'SELLER' && <NavLink to="/seller" onClick={() => setMenuOpen(false)}>My listings</NavLink>}
            {user && <button className="mobile-logout" onClick={signOut}>Log out</button>}
          </nav>
          <div className="nav-actions">
            {user ? (
              <>
                <span className="subtle" style={{ fontSize: 13 }}>Hi, {user.name.split(' ')[0]}</span>
                <button className="btn btn-outline btn-small" onClick={signOut}>Log out</button>
              </>
            ) : (
              <>
                <Link className="btn btn-quiet btn-small" to="/login">Log in</Link>
                <Link className="btn btn-primary btn-small" to="/register">Get started</Link>
              </>
            )}
          </div>
          <button className="menu-toggle" onClick={() => setMenuOpen((open) => !open)} aria-label={menuOpen ? 'Close menu' : 'Open menu'} aria-expanded={menuOpen}>
            {menuOpen ? <X size={23} /> : <Menu size={23} />}
          </button>
        </div>
      </header>
      <Outlet />
      <footer className="site-footer">
        <div className="container">
          <div className="footer-row">
            <div>
              <Link className="brand footer-brand" to="/"><span className="brand-mark"><Building2 size={18} /></span>smartestate.</Link>
              <p className="footer-copy">A clearer way to find your next place. Explore thoughtfully, compare confidently, and make your next move with care.</p>
            </div>
            <div className="footer-links">
              <Link to="/">Home</Link>
              <a href="/#discover">Explore homes</a>
              <Link to="/register">List a property</Link>
              <Link to="/login">Sign in</Link>
            </div>
          </div>
          <div className="footer-bottom">© {new Date().getFullYear()} SmartEstate AI. AI estimates are informational and not guaranteed market valuations.</div>
        </div>
      </footer>
    </div>
  )
}
