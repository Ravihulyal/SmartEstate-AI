import { useCallback, useEffect, useState } from 'react'
import { CalendarClock, History, Pencil, RefreshCw, StopCircle, XCircle } from 'lucide-react'
import { Spinner } from './Spinner'
import { getErrorMessage } from '../services/api'
import {
  cancelAuction,
  endAuctionEarly,
  getAdminAuctions,
  getAuctionAudit,
  getMyAuctions,
  updateAuctionSchedule,
} from '../services/auctions'
import { notify } from '../services/toast'
import type { Auction, AuctionAuditEntry, AuctionListResponse } from '../types'

type ManagementMode = 'SELLER' | 'ADMIN'

function localDateTime(value: string): string {
  const date = new Date(value)
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
}

function statusLabel(status: Auction['status']): string {
  if (status === 'ACTIVE') return 'LIVE'
  if (status === 'COMPLETED') return 'ENDED'
  return status
}

function currency(amount: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2,
  }).format(amount)
}

function outcomeLabel(outcome: Auction['outcomeStatus']): string {
  switch (outcome) {
    case 'NO_BIDS':
      return 'No bids'
    case 'PENDING_SELLER_APPROVAL':
      return 'Pending seller approval'
    case 'ACCEPTED':
      return 'Highest bid accepted'
    case 'REJECTED':
      return 'Highest bid rejected'
    default:
      return 'Not decided'
  }
}

export function AuctionManagementPanel({ mode }: { mode: ManagementMode }) {
  const [auctions, setAuctions] = useState<Auction[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState('')
  const [error, setError] = useState('')
  const [editingId, setEditingId] = useState('')
  const [startTime, setStartTime] = useState('')
  const [endTime, setEndTime] = useState('')
  const [reasons, setReasons] = useState<Record<string, string>>({})
  const [auditId, setAuditId] = useState('')
  const [audit, setAudit] = useState<AuctionAuditEntry[]>([])

  const refresh = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const result: AuctionListResponse = mode === 'ADMIN'
        ? await getAdminAuctions()
        : await getMyAuctions()
      setAuctions(result.auctions)
    } catch (requestError: unknown) {
      setError(getErrorMessage(requestError, 'Auctions could not be loaded.'))
    } finally {
      setLoading(false)
    }
  }, [mode])

  useEffect(() => {
    let active = true
    const load = async () => {
      try {
        const result = mode === 'ADMIN' ? await getAdminAuctions() : await getMyAuctions()
        if (active) setAuctions(result.auctions)
      } catch (requestError: unknown) {
        if (active) setError(getErrorMessage(requestError, 'Auctions could not be loaded.'))
      } finally {
        if (active) setLoading(false)
      }
    }
    void load()
    return () => { active = false }
  }, [mode])

  function beginEdit(auction: Auction) {
    setEditingId(auction.id)
    setStartTime(localDateTime(auction.startTime))
    setEndTime(localDateTime(auction.endTime))
    setError('')
  }

  async function saveSchedule(auction: Auction) {
    const startsAt = new Date(startTime)
    const endsAt = new Date(endTime)
    if (
      Number.isNaN(startsAt.getTime()) ||
      Number.isNaN(endsAt.getTime()) ||
      startsAt <= new Date() ||
      endsAt <= startsAt
    ) {
      setError('Choose a future start time and an end time after it.')
      return
    }

    setBusyId(auction.id)
    setError('')
    try {
      await updateAuctionSchedule(auction.id, {
        startTime: startsAt.toISOString(),
        endTime: endsAt.toISOString(),
      })
      setEditingId('')
      notify('Auction schedule updated.')
      await refresh()
    } catch (requestError: unknown) {
      setError(getErrorMessage(requestError, 'Auction schedule could not be updated.'))
    } finally {
      setBusyId('')
    }
  }

  async function cancel(auction: Auction) {
    const reason = reasons[auction.id]?.trim()
    if (mode === 'ADMIN' && (!reason || reason.length < 5)) {
      setError('Enter an administrative reason of at least 5 characters.')
      return
    }
    if (!window.confirm(`Cancel the auction for ${auction.property.title}?`)) return

    setBusyId(auction.id)
    setError('')
    try {
      await cancelAuction(auction.id, mode === 'ADMIN' ? reason : undefined)
      notify('Auction cancelled.')
      await refresh()
    } catch (requestError: unknown) {
      setError(getErrorMessage(requestError, 'Auction could not be cancelled.'))
    } finally {
      setBusyId('')
    }
  }

  async function endEarly(auction: Auction) {
    const reason = reasons[auction.id]?.trim()
    if (!reason || reason.length < 5) {
      setError('Enter an administrative reason of at least 5 characters.')
      return
    }
    if (!window.confirm(`End the live auction for ${auction.property.title} now?`)) return

    setBusyId(auction.id)
    setError('')
    try {
      await endAuctionEarly(auction.id, reason)
      notify('Auction ended early.')
      await refresh()
    } catch (requestError: unknown) {
      setError(getErrorMessage(requestError, 'Auction could not be ended early.'))
    } finally {
      setBusyId('')
    }
  }

  async function toggleAudit(auction: Auction) {
    if (auditId === auction.id) {
      setAuditId('')
      return
    }
    setBusyId(auction.id)
    setError('')
    try {
      const result = await getAuctionAudit(auction.id)
      setAudit(result.audit)
      setAuditId(auction.id)
    } catch (requestError: unknown) {
      setError(getErrorMessage(requestError, 'Auction audit history could not be loaded.'))
    } finally {
      setBusyId('')
    }
  }

  return (
    <section className="auction-management">
      <div className="section-head">
        <div>
          <span className="eyebrow">{mode === 'ADMIN' ? 'Administration' : 'Seller workspace'}</span>
          <h2>{mode === 'ADMIN' ? 'Auction management' : 'Your auctions'}</h2>
        </div>
        <button className="btn btn-outline" type="button" onClick={() => void refresh()} disabled={loading}>
          <RefreshCw size={15} />Refresh auctions
        </button>
      </div>
      {error && <div className="error-box" role="alert">{error}</div>}
      {loading ? <Spinner label="Loading auctions" /> : auctions.length === 0 ? (
        <div className="empty-state"><CalendarClock size={25} /><h3>No auctions to manage</h3><p>Auctions for approved properties will appear here.</p></div>
      ) : (
        <div className="auction-management-list">
          {auctions.map((auction) => {
            const isUpcoming = auction.status === 'UPCOMING'
            const isLive = auction.status === 'ACTIVE'
            const isAdmin = mode === 'ADMIN'
            const sellerName = auction.property.seller?.name
            return (
              <article className="admin-card auction-management-card" key={auction.id}>
                <div className="auction-management-content">
                  <div className="auction-management-heading">
                    <div>
                      <span className={`auction-status auction-status-${auction.status.toLowerCase()}`}>{statusLabel(auction.status)}</span>
                      <h3>{auction.property.title}</h3>
                    </div>
                    {isAdmin && <span className="listing-meta">Seller: {sellerName ?? 'Seller unavailable'}</span>}
                  </div>
                  <div className="auction-management-details">
                    <span><strong>Start</strong>{new Date(auction.startTime).toLocaleString()}</span>
                    <span><strong>End</strong>{new Date(auction.endTime).toLocaleString()}</span>
                    <span><strong>Current highest bid</strong>{auction.currentBid === null ? `No bids · ${currency(auction.startPrice)} starting price` : currency(auction.currentBid)}</span>
                    <span><strong>Auction outcome</strong>{outcomeLabel(auction.outcomeStatus)}</span>
                    {auction.sellerDecisionAt && (
                      <span>
                        <strong>Seller decision</strong>
                        {new Date(auction.sellerDecisionAt).toLocaleString()}
                        {auction.sellerDecisionReason ? ` · ${auction.sellerDecisionReason}` : ''}
                      </span>
                    )}
                  </div>

                  {editingId === auction.id ? (
                    <div className="auction-schedule-form">
                      <div className="field"><label htmlFor={`start-${auction.id}`}>New start time</label><input id={`start-${auction.id}`} type="datetime-local" value={startTime} onChange={(event) => setStartTime(event.target.value)} required /></div>
                      <div className="field"><label htmlFor={`end-${auction.id}`}>New end time</label><input id={`end-${auction.id}`} type="datetime-local" value={endTime} onChange={(event) => setEndTime(event.target.value)} required /></div>
                      <div className="auction-management-actions">
                        <button className="btn btn-primary btn-small" type="button" disabled={busyId === auction.id} onClick={() => void saveSchedule(auction)}>Save schedule</button>
                        <button className="btn btn-quiet btn-small" type="button" onClick={() => setEditingId('')}>Discard</button>
                      </div>
                    </div>
                  ) : null}

                  {isAdmin && (isUpcoming || isLive) && (
                    <div className="field auction-reason-field">
                      <label htmlFor={`reason-${auction.id}`}>Administrative action reason</label>
                      <textarea
                        id={`reason-${auction.id}`}
                        maxLength={500}
                        minLength={5}
                        value={reasons[auction.id] ?? ''}
                        onChange={(event) => setReasons((current) => ({ ...current, [auction.id]: event.target.value }))}
                        rows={2}
                      />
                    </div>
                  )}

                  <div className="auction-management-actions">
                    {isUpcoming && editingId !== auction.id && (
                      <button className="btn btn-outline btn-small" type="button" onClick={() => beginEdit(auction)}><Pencil size={14} />Edit schedule</button>
                    )}
                    {isUpcoming && (isAdmin || mode === 'SELLER') && (
                      <button className="btn btn-danger btn-small" type="button" disabled={busyId === auction.id || (isAdmin && (reasons[auction.id]?.trim().length ?? 0) < 5)} onClick={() => void cancel(auction)}>
                        <XCircle size={14} />Cancel auction
                      </button>
                    )}
                    {isAdmin && isLive && (
                      <>
                        <button className="btn btn-danger btn-small" type="button" disabled={busyId === auction.id || (reasons[auction.id]?.trim().length ?? 0) < 5} onClick={() => void cancel(auction)}>
                          <XCircle size={14} />Cancel auction
                        </button>
                        <button className="btn btn-outline btn-small" type="button" disabled={busyId === auction.id || (reasons[auction.id]?.trim().length ?? 0) < 5} onClick={() => void endEarly(auction)}>
                          <StopCircle size={14} />End early
                        </button>
                      </>
                    )}
                    {isAdmin && (
                      <button className="btn btn-quiet btn-small" type="button" disabled={busyId === auction.id} onClick={() => void toggleAudit(auction)}>
                        <History size={14} />{auditId === auction.id ? 'Hide audit' : 'Audit history'}
                      </button>
                    )}
                  </div>
                  {auditId === auction.id && (
                    <div className="auction-audit" aria-label={`Audit history for ${auction.property.title}`}>
                      {audit.length === 0 ? <p className="subtle">No administrative actions recorded.</p> : audit.map((entry) => (
                        <div className="auction-audit-entry" key={entry.id}>
                          <strong>
                            {entry.action === 'ENDED_EARLY'
                              ? 'Ended early'
                              : entry.action === 'CANCELLED'
                                ? 'Cancelled'
                                : entry.action === 'WINNER_APPROVED'
                                  ? 'Highest bid accepted'
                                  : 'Highest bid rejected'}
                          </strong>
                          <span>{entry.reason ?? 'No reason recorded.'}</span>
                          <span>
                            {entry.seller
                              ? `Seller: ${entry.seller.name}`
                              : `Admin: ${entry.admin?.name ?? 'Unknown administrator'}`}
                            {' · Auction: '}{entry.auctionId}
                          </span>
                          <time dateTime={entry.createdAt}>{new Date(entry.createdAt).toLocaleString()}</time>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </article>
            )
          })}
        </div>
      )}
    </section>
  )
}
