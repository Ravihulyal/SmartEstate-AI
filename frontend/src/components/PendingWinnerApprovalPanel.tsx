import { useCallback, useEffect, useState } from 'react'
import { Check, Clock3, X } from 'lucide-react'
import { Link } from 'react-router-dom'
import { FallbackImage } from './FallbackImage'
import { Spinner } from './Spinner'
import { getErrorMessage } from '../services/api'
import {
  approveAuctionWinner,
  getPendingSellerApprovals,
  rejectAuctionWinner,
} from '../services/auctions'
import { notify } from '../services/toast'
import type { PendingSellerApproval } from '../types'

function currency(amount: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2,
  }).format(amount)
}

export function PendingWinnerApprovalPanel() {
  const [auctions, setAuctions] = useState<PendingSellerApproval[]>([])
  const [reasons, setReasons] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState('')
  const [error, setError] = useState('')

  const refresh = useCallback(async () => {
    setError('')
    try {
      const result = await getPendingSellerApprovals()
      setAuctions(result.auctions)
    } catch (requestError: unknown) {
      setError(getErrorMessage(requestError, 'Pending winner approvals could not be loaded.'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    let active = true
    getPendingSellerApprovals()
      .then((result) => {
        if (active) setAuctions(result.auctions)
      })
      .catch((requestError: unknown) => {
        if (active) setError(getErrorMessage(requestError, 'Pending winner approvals could not be loaded.'))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => { active = false }
  }, [])

  async function decide(auction: PendingSellerApproval, decision: 'accept' | 'reject') {
    const reason = reasons[auction.id]?.trim()
    if (decision === 'reject' && (!reason || reason.length < 5)) {
      setError('Enter a rejection reason of at least 5 characters.')
      return
    }

    const confirmed = decision === 'accept'
      ? window.confirm(`Accept the highest bid for ${auction.property.title}? This does not process payment or transfer ownership.`)
      : window.confirm(`Reject the highest bid for ${auction.property.title}?`)
    if (!confirmed) return

    setBusyId(auction.id)
    setError('')
    try {
      if (decision === 'accept') {
        await approveAuctionWinner(auction.id, reason || undefined)
        notify('Highest bid accepted. Payment and ownership transfer are not included.')
      } else {
        await rejectAuctionWinner(auction.id, reason!)
        notify('Highest bid rejected; the property was not sold through this auction.')
      }
      await refresh()
    } catch (requestError: unknown) {
      setError(getErrorMessage(requestError, 'The seller decision could not be saved.'))
    } finally {
      setBusyId('')
    }
  }

  return (
    <section className="auction-management pending-winner-approval">
      <div className="section-head">
        <div>
          <span className="eyebrow">Seller workspace</span>
          <h2>Pending Winner Approval</h2>
        </div>
      </div>
      {error && <div className="error-box" role="alert">{error}</div>}
      {loading ? <Spinner label="Loading pending winner approvals" /> : auctions.length === 0 ? (
        <div className="empty-state">
          <Clock3 size={25} />
          <h3>No auctions need a decision</h3>
          <p>Completed auctions with bids will appear here until you accept or reject the highest bid.</p>
        </div>
      ) : (
        <div className="auction-management-list">
          {auctions.map((auction) => (
            <article className="admin-card auction-management-card" key={auction.id}>
              <div className="admin-photo auction-management-photo">
                <FallbackImage
                  src={auction.property.images[0] ?? ''}
                  alt={auction.property.title}
                />
              </div>
              <div className="auction-management-content">
                <div className="auction-management-heading">
                  <div>
                    <span className="auction-status auction-status-completed">Pending seller approval</span>
                    <h3><Link to={`/auctions/${encodeURIComponent(auction.id)}`}>{auction.property.title}</Link></h3>
                  </div>
                </div>
                <div className="auction-management-details">
                  <span><strong>Final highest bid</strong>{currency(auction.winningBid.amount)}</span>
                  <span><strong>Highest bidder</strong>{auction.winningBid.bidderName}</span>
                  <span><strong>Auction ended</strong>{new Date(auction.endTime).toLocaleString()}</span>
                </div>
                <div className="auction-approval-history">
                  <strong>Bid history</strong>
                  {auction.bids.length === 0 ? <p className="subtle">No bid history is available.</p> : (
                    <ol className="auction-bids">
                      {auction.bids.map((bid) => (
                        <li key={bid.id}>
                          <span>{new Date(bid.createdAt).toLocaleString()}</span>
                          <strong>{currency(bid.amount)}</strong>
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
                <div className="field auction-reason-field">
                  <label htmlFor={`rejection-reason-${auction.id}`}>Rejection reason (required to reject)</label>
                  <textarea
                    id={`rejection-reason-${auction.id}`}
                    minLength={5}
                    maxLength={500}
                    rows={2}
                    value={reasons[auction.id] ?? ''}
                    onChange={(event) => setReasons((current) => ({
                      ...current,
                      [auction.id]: event.target.value,
                    }))}
                  />
                </div>
                <div className="auction-management-actions">
                  <button
                    className="btn btn-primary btn-small"
                    type="button"
                    disabled={busyId === auction.id}
                    onClick={() => void decide(auction, 'accept')}
                  >
                    <Check size={14} />Accept highest bid
                  </button>
                  <button
                    className="btn btn-danger btn-small"
                    type="button"
                    disabled={busyId === auction.id || (reasons[auction.id]?.trim().length ?? 0) < 5}
                    onClick={() => void decide(auction, 'reject')}
                  >
                    <X size={14} />Reject highest bid
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  )
}
