import { useCallback, useEffect, useState } from 'react'
import { Check, ClipboardList, X } from 'lucide-react'
import { getPendingListings, getProperties, setPropertyStatus } from '../services/properties'
import { getErrorMessage } from '../services/api'
import { notify } from '../services/toast'
import { StatusBadge } from '../components/StatusBadge'
import { Spinner } from '../components/Spinner'
import type { Property } from '../types'

function amount(property: Property): string {
  const price = property.listingType === 'SALE' ? property.price : property.rentPerMonth
  if (price === null) return 'Price unavailable'
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(price)
}

export function AdminDashboard() {
  const [pending, setPending] = useState<Property[]>([])
  const [approvedCount, setApprovedCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState('')
  const [error, setError] = useState('')

  const refresh = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [pendingResult, publicResult] = await Promise.all([getPendingListings(), getProperties()])
      setPending(pendingResult.properties)
      setApprovedCount(publicResult.count)
    } catch (requestError: unknown) {
      setError(getErrorMessage(requestError, 'The admin review queue could not be loaded.'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    let active = true
    Promise.all([getPendingListings(), getProperties()])
      .then(([pendingResult, publicResult]) => {
        if (active) {
          setPending(pendingResult.properties)
          setApprovedCount(publicResult.count)
        }
      })
      .catch((requestError: unknown) => {
        if (active) setError(getErrorMessage(requestError, 'The admin review queue could not be loaded.'))
      })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])

  async function review(property: Property, status: 'APPROVED' | 'REJECTED') {
    setBusyId(property.id)
    setError('')
    try {
      await setPropertyStatus(property.id, status)
      setPending((current) => current.filter((item) => item.id !== property.id))
      if (status === 'APPROVED') setApprovedCount((count) => count + 1)
      notify(`Property ${status.toLowerCase()}.`)
    } catch (requestError: unknown) {
      setError(getErrorMessage(requestError, 'The listing status could not be updated.'))
    } finally {
      setBusyId('')
    }
  }

  return (
    <main className="page-wrap">
      <div className="container">
        <div className="page-heading">
          <div><span className="eyebrow">Administration</span><h1 className="page-title">Listing review</h1><p className="subtle">Review submitted properties before they become visible to buyers.</p></div>
          <button className="btn btn-outline" onClick={() => void refresh()} disabled={loading}><ClipboardList size={16} />Refresh queue</button>
        </div>
        <div className="stats-grid">
          <div className="stat-card"><span className="stat-label">Awaiting review</span><strong className="stat-value">{pending.length}</strong></div>
          <div className="stat-card"><span className="stat-label">Approved public listings</span><strong className="stat-value">{approvedCount}</strong></div>
          <div className="stat-card"><span className="stat-label">User overview</span><strong className="stat-value">—</strong><span className="label-note">User directory is not available in the current API.</span></div>
        </div>
        {error && <div className="error-box" role="alert" style={{ marginBottom: 18 }}>{error}</div>}
        <section>
          <div className="section-head"><div><span className="eyebrow">Needs your attention</span><h2>Pending submissions</h2></div></div>
          {loading ? <Spinner label="Loading pending properties" /> : pending.length === 0 ? <div className="empty-state"><ClipboardList size={26} /><h3>You're all caught up</h3><p>New seller submissions will appear here for review.</p></div> : (
            <div className="admin-grid">
              {pending.map((property) => (
                <article className="admin-card" key={property.id}>
                  <div className="admin-photo">{property.images[0] ? <img src={property.images[0]} alt={property.title} /> : <ClipboardList size={27} />}</div>
                  <div>
                    <div className="status-filter"><StatusBadge status={property.status} /><span className="property-tag" style={{ position: 'static', background: '#eef4ed' }}>{property.listingType}</span></div>
                    <h3>{property.title}</h3>
                    <div className="listing-meta">{property.location}, {property.city}, {property.state} · {property.bhk} BHK · {property.totalSqft.toLocaleString('en-IN')} sqft</div>
                    <p>{property.description}</p>
                    <strong>{amount(property)}</strong>
                    {property.listingType === 'SALE' && property.predictedPriceLakhs !== null && <div className="ai-estimate">AI estimated sale price<strong>₹{property.predictedPriceLakhs.toLocaleString('en-IN', { maximumFractionDigits: 2 })} Lakhs</strong></div>}
                    <div className="listing-meta" style={{ marginTop: 10 }}>Seller: {property.seller?.name ?? property.sellerId}{property.seller?.email ? ` · ${property.seller.email}` : ''}</div>
                  </div>
                  <div className="admin-actions">
                    <button className="btn btn-primary btn-small" disabled={busyId === property.id} onClick={() => void review(property, 'APPROVED')}><Check size={14} />Approve</button>
                    <button className="btn btn-danger btn-small" disabled={busyId === property.id} onClick={() => void review(property, 'REJECTED')}><X size={14} />Reject</button>
                    {busyId === property.id && <span className="label-note">Updating…</span>}
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  )
}
