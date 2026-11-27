import { useCallback, useEffect, useState } from 'react'
import { Clock3, CreditCard, ExternalLink, ReceiptText, RefreshCw, RotateCcw } from 'lucide-react'
import { Link } from 'react-router-dom'
import { FallbackImage } from './FallbackImage'
import { PaymentPagination } from './PaymentPagination'
import { PaymentStatusBadge } from './PaymentStatusBadge'
import { Spinner } from './Spinner'
import { usePaymentNotifications } from '../hooks/usePaymentNotifications'
import { getErrorMessage } from '../services/api'
import {
  getBuyerPayment,
  getBuyerPaymentHistory,
  getBuyerPendingPayments,
  retryBuyerPayment,
  simulateBuyerPayment,
} from '../services/payments'
import { notify } from '../services/toast'
import type { BuyerPayment } from '../types'

type PaymentTab = 'pending' | 'history'

function formatInr(amount: string): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2,
  }).format(Number(amount))
}

function formatDate(value: string | null): string {
  return value ? new Date(value).toLocaleString() : 'Not recorded'
}

export function BuyerPaymentsPanel() {
  const [tab, setTab] = useState<PaymentTab>('pending')
  const [pendingPayments, setPendingPayments] = useState<BuyerPayment[]>([])
  const [historyPayments, setHistoryPayments] = useState<BuyerPayment[]>([])
  const [historyPage, setHistoryPage] = useState(1)
  const [historyHasMore, setHistoryHasMore] = useState(false)
  const [selectedId, setSelectedId] = useState('')
  const [selectedPayment, setSelectedPayment] = useState<BuyerPayment | null>(null)
  const [previousReferences, setPreviousReferences] = useState<Record<string, string[]>>({})
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [detailsLoading, setDetailsLoading] = useState(false)
  const [busyId, setBusyId] = useState('')
  const [error, setError] = useState('')
  const [detailsError, setDetailsError] = useState('')

  const loadData = useCallback(() => Promise.all([
    getBuyerPendingPayments(),
    getBuyerPaymentHistory({ page: historyPage, limit: 10 }),
  ]), [historyPage])

  const refresh = useCallback(async () => {
    setRefreshing(true)
    setError('')
    try {
      const [pending, history] = await loadData()
      setPendingPayments(pending.payments)
      setHistoryPayments(history.payments)
      setHistoryHasMore(history.pagination.hasMore)
    } catch (requestError: unknown) {
      setError(getErrorMessage(requestError, 'Your payment information could not be loaded.'))
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [loadData])

  useEffect(() => {
    let active = true
    loadData()
      .then(([pending, history]) => {
        if (!active) return
        setPendingPayments(pending.payments)
        setHistoryPayments(history.payments)
        setHistoryHasMore(history.pagination.hasMore)
      })
      .catch((requestError: unknown) => {
        if (active) setError(getErrorMessage(requestError, 'Your payment information could not be loaded.'))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => { active = false }
  }, [loadData])

  usePaymentNotifications(refresh)

  async function toggleDetails(payment: BuyerPayment) {
    if (selectedId === payment.id) {
      setSelectedId('')
      setSelectedPayment(null)
      setDetailsError('')
      return
    }

    setSelectedId(payment.id)
    setDetailsLoading(true)
    setDetailsError('')
    try {
      const result = await getBuyerPayment(payment.id)
      setSelectedPayment(result.payment)
    } catch (requestError: unknown) {
      setDetailsError(getErrorMessage(requestError, 'Payment details could not be loaded.'))
      setSelectedPayment(payment)
    } finally {
      setDetailsLoading(false)
    }
  }

  async function simulate(payment: BuyerPayment, outcome: 'SUCCESS' | 'FAILED') {
    setBusyId(payment.id)
    setError('')
    try {
      const result = await simulateBuyerPayment(payment.id, outcome)
      setSelectedPayment(result.payment)
      notify(result.message)
      await refresh()
    } catch (requestError: unknown) {
      setError(getErrorMessage(requestError, 'The simulated payment could not be recorded.'))
      try {
        const latest = await getBuyerPayment(payment.id)
        setSelectedPayment(latest.payment)
      } catch (detailRequestError: unknown) {
        setDetailsError(getErrorMessage(detailRequestError, 'Payment details could not be refreshed.'))
      }
      await refresh()
    } finally {
      setBusyId('')
    }
  }

  async function retry(payment: BuyerPayment) {
    setBusyId(payment.id)
    setError('')
    try {
      const result = await retryBuyerPayment(payment.id)
      setPreviousReferences((current) => ({
        ...current,
        [payment.id]: [...(current[payment.id] ?? []), payment.transactionReference],
      }))
      setSelectedId(payment.id)
      setSelectedPayment(result.payment)
      notify('A new simulated payment attempt is ready.')
      await refresh()
    } catch (requestError: unknown) {
      setError(getErrorMessage(requestError, 'A payment retry could not be started.'))
      await refresh()
    } finally {
      setBusyId('')
    }
  }

  const visiblePayments = tab === 'pending' ? pendingPayments : historyPayments

  return (
    <section id="payments" className="demo-workflow-panel">
      <div className="section-head demo-workflow-heading">
        <div>
          <span className="eyebrow">Buyer workspace · simulated only</span>
          <h2>My payments</h2>
          <p className="subtle">Payment outcomes are simulated for this demonstration. No money is moved or payment credentials collected.</p>
        </div>
        <button className="btn btn-outline btn-small" type="button" onClick={() => void refresh()} disabled={refreshing}>
          <RefreshCw size={15} />{refreshing ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {error && <div className="error-box" role="alert">{error}</div>}
      <div className="payment-tabs" role="tablist" aria-label="Payment views">
        <button type="button" role="tab" aria-selected={tab === 'pending'} onClick={() => setTab('pending')}>
          Pending ({pendingPayments.length})
        </button>
        <button type="button" role="tab" aria-selected={tab === 'history'} onClick={() => setTab('history')}>
          Payment history
        </button>
      </div>

      {loading ? <Spinner label="Loading your payments" /> : visiblePayments.length === 0 ? (
        <div className="empty-state payment-empty-state">
          {tab === 'pending' ? <Clock3 size={25} /> : <ReceiptText size={25} />}
          <h3>{tab === 'pending' ? 'No pending payment requests' : 'No payment history yet'}</h3>
          <p>{tab === 'pending'
            ? 'A request will appear here if a seller accepts your highest auction bid.'
            : 'Your simulated payment attempts will appear here.'}</p>
        </div>
      ) : (
        <div className="payment-card-list">
          {visiblePayments.map((payment) => {
            const details = selectedId === payment.id && selectedPayment?.id === payment.id ? selectedPayment : payment
            return (
              <article className="payment-card" key={payment.id}>
                <div className="payment-card-main">
                  <FallbackImage src={payment.property.images[0] ?? ''} alt={payment.property.title} />
                  <div className="payment-card-info">
                    <div className="payment-card-title-row">
                      <div>
                        <h3>{payment.property.title}</h3>
                        <p className="subtle">{payment.property.city}, {payment.property.state}</p>
                      </div>
                      <PaymentStatusBadge status={payment.status} />
                    </div>
                    <div className="payment-summary-grid">
                      <span><strong>Accepted bid amount</strong>{formatInr(payment.amount)}</span>
                      <span><strong>Created</strong>{formatDate(payment.createdAt)}</span>
                      <span><strong>Payment mode</strong>Simulated demo</span>
                    </div>
                    <div className="payment-card-actions">
                      <button className="btn btn-outline btn-small" type="button" aria-expanded={selectedId === payment.id} onClick={() => void toggleDetails(payment)}>
                        <ExternalLink size={14} />{selectedId === payment.id ? 'Hide details' : 'Payment details'}
                      </button>
                    </div>
                  </div>
                </div>

                {selectedId === payment.id && (
                  <div className="payment-detail-panel">
                    {detailsError && <div className="error-box" role="alert">{detailsError}</div>}
                    {detailsLoading ? <Spinner label="Loading payment details" /> : (
                      <>
                        <div className="payment-summary-grid">
                          <span><strong>Transaction reference</strong><code>{details.transactionReference}</code></span>
                          <span><strong>Expires</strong>{formatDate(details.expiresAt)}</span>
                          <span><strong>Paid at</strong>{formatDate(details.paidAt)}</span>
                          <span><strong>Closing status</strong>{details.saleClosing?.status?.toLowerCase() ?? 'Not created'}</span>
                        </div>
                        {details.failureReason && <p className="payment-failure-reason"><strong>Latest attempt:</strong> {details.failureReason}</p>}
                        {(previousReferences[payment.id] ?? []).length > 0 && (
                          <div className="payment-previous-attempts">
                            <strong>Previous references seen in this session</strong>
                            <ul>{previousReferences[payment.id].map((reference, index) => <li key={`${reference}-${index}`}><code>{reference}</code></li>)}</ul>
                          </div>
                        )}
                        {details.simulatedReceipt && (
                          <div className="simulated-receipt">
                            <ReceiptText size={18} />
                            <div>
                              <strong>Simulated receipt</strong>
                              <p>{details.simulatedReceipt.receiptReference}</p>
                              <span>{formatInr(details.simulatedReceipt.amount)} · {formatDate(details.simulatedReceipt.paidAt)}</span>
                            </div>
                          </div>
                        )}
                        {details.status === 'PENDING' && (
                          <div className="simulation-area">
                            <p className="demo-disclaimer">Demo only: choose a simulated outcome. This does not authorize or process a real payment.</p>
                            <p className="subtle" role="status">The server verifies whether this request is still valid when you choose an outcome.</p>
                            <div className="payment-card-actions">
                              <button className="btn btn-primary btn-small" type="button" disabled={busyId === payment.id} onClick={() => void simulate(details, 'SUCCESS')}>
                                <CreditCard size={14} />{busyId === payment.id ? 'Recording…' : 'Simulate successful payment'}
                              </button>
                              <button className="btn btn-outline btn-small" type="button" disabled={busyId === payment.id} onClick={() => void simulate(details, 'FAILED')}>
                                Simulate failed payment
                              </button>
                            </div>
                          </div>
                        )}
                        {(details.status === 'FAILED' || details.status === 'EXPIRED') && (
                          <div className="payment-card-actions">
                            <button className="btn btn-outline btn-small" type="button" disabled={busyId === payment.id} onClick={() => void retry(details)}>
                              <RotateCcw size={14} />{busyId === payment.id ? 'Starting…' : 'Start a new simulated attempt'}
                            </button>
                          </div>
                        )}
                        {details.saleClosing && (
                          <p className="payment-closing-note">
                            {details.saleClosing.status === 'COMPLETED'
                              ? 'The seller completed the demo closing. This does not transfer legal property title.'
                              : 'Payment succeeded; the seller must still confirm the demo sale closing.'}
                          </p>
                        )}
                        <Link className="payment-auction-link" to={`/auctions/${encodeURIComponent(payment.auctionId)}`}>View auction and bid history</Link>
                      </>
                    )}
                  </div>
                )}
              </article>
            )
          })}
        </div>
      )}

      {tab === 'history' && (
        <PaymentPagination page={historyPage} hasMore={historyHasMore} busy={refreshing} onChange={setHistoryPage} />
      )}
    </section>
  )
}
