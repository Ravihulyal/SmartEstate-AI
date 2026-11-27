import { useCallback, useEffect, useState } from 'react'
import { CheckCircle2, CreditCard, RefreshCw, ShieldCheck } from 'lucide-react'
import { FallbackImage } from './FallbackImage'
import { PaymentPagination } from './PaymentPagination'
import { PaymentStatusBadge } from './PaymentStatusBadge'
import { Spinner } from './Spinner'
import { usePaymentNotifications } from '../hooks/usePaymentNotifications'
import { getErrorMessage } from '../services/api'
import {
  confirmSellerClosing,
  getSellerClosings,
  getSellerPayments,
} from '../services/payments'
import { notify } from '../services/toast'
import type { SaleClosing, SellerPayment } from '../types'

type SellerTab = 'payments' | 'pending' | 'history'

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

export function SellerClosingPanel({ onClosingCompleted }: { onClosingCompleted?: () => void }) {
  const [tab, setTab] = useState<SellerTab>('pending')
  const [payments, setPayments] = useState<SellerPayment[]>([])
  const [pendingClosings, setPendingClosings] = useState<SaleClosing[]>([])
  const [completedClosings, setCompletedClosings] = useState<SaleClosing[]>([])
  const [paymentPage, setPaymentPage] = useState(1)
  const [pendingPage, setPendingPage] = useState(1)
  const [historyPage, setHistoryPage] = useState(1)
  const [paymentHasMore, setPaymentHasMore] = useState(false)
  const [pendingHasMore, setPendingHasMore] = useState(false)
  const [historyHasMore, setHistoryHasMore] = useState(false)
  const [confirming, setConfirming] = useState<SaleClosing | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [busyId, setBusyId] = useState('')
  const [error, setError] = useState('')

  const loadData = useCallback(() => Promise.all([
    getSellerPayments({ page: paymentPage, limit: 10 }),
    getSellerClosings({ page: pendingPage, limit: 10, status: 'PENDING' }),
    getSellerClosings({ page: historyPage, limit: 10, status: 'COMPLETED' }),
  ]), [historyPage, paymentPage, pendingPage])

  const refresh = useCallback(async () => {
    setRefreshing(true)
    setError('')
    try {
      const [paymentResult, pendingResult, historyResult] = await loadData()
      setPayments(paymentResult.payments)
      setPaymentHasMore(paymentResult.pagination.hasMore)
      setPendingClosings(pendingResult.closings)
      setPendingHasMore(pendingResult.pagination.hasMore)
      setCompletedClosings(historyResult.closings)
      setHistoryHasMore(historyResult.pagination.hasMore)
    } catch (requestError: unknown) {
      setError(getErrorMessage(requestError, 'Seller payment and closing information could not be loaded.'))
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [loadData])

  useEffect(() => {
    let active = true
    loadData()
      .then(([paymentResult, pendingResult, historyResult]) => {
        if (!active) return
        setPayments(paymentResult.payments)
        setPaymentHasMore(paymentResult.pagination.hasMore)
        setPendingClosings(pendingResult.closings)
        setPendingHasMore(pendingResult.pagination.hasMore)
        setCompletedClosings(historyResult.closings)
        setHistoryHasMore(historyResult.pagination.hasMore)
      })
      .catch((requestError: unknown) => {
        if (active) setError(getErrorMessage(requestError, 'Seller payment and closing information could not be loaded.'))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => { active = false }
  }, [loadData])

  usePaymentNotifications(refresh)

  async function completeClosing() {
    if (!confirming) return
    setBusyId(confirming.id)
    setError('')
    try {
      await confirmSellerClosing(confirming.id)
      notify('Demo sale closing completed. This does not transfer legal property title.')
      setConfirming(null)
      await refresh()
      onClosingCompleted?.()
    } catch (requestError: unknown) {
      setError(getErrorMessage(requestError, 'The demo sale closing could not be completed.'))
    } finally {
      setBusyId('')
    }
  }

  const activeItems = tab === 'payments'
    ? payments
    : tab === 'pending' ? pendingClosings : completedClosings
  const activePage = tab === 'payments' ? paymentPage : tab === 'pending' ? pendingPage : historyPage
  const activeHasMore = tab === 'payments' ? paymentHasMore : tab === 'pending' ? pendingHasMore : historyHasMore
  const changePage = tab === 'payments' ? setPaymentPage : tab === 'pending' ? setPendingPage : setHistoryPage

  return (
    <section id="closings" className="demo-workflow-panel">
      <div className="section-head demo-workflow-heading">
        <div>
          <span className="eyebrow">Seller workspace · simulated only</span>
          <h2>Payment &amp; closing management</h2>
          <p className="subtle">Track accepted-bid payments and confirm eligible demo closings. No buyer payment credentials are collected or shown.</p>
        </div>
        <button className="btn btn-outline btn-small" type="button" onClick={() => void refresh()} disabled={refreshing}>
          <RefreshCw size={15} />{refreshing ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {error && <div className="error-box" role="alert">{error}</div>}
      <div className="payment-tabs" role="tablist" aria-label="Seller payment and closing views">
        <button type="button" role="tab" aria-selected={tab === 'pending'} onClick={() => setTab('pending')}>
          Pending closings ({pendingClosings.length})
        </button>
        <button type="button" role="tab" aria-selected={tab === 'history'} onClick={() => setTab('history')}>
          Completed closings
        </button>
        <button type="button" role="tab" aria-selected={tab === 'payments'} onClick={() => setTab('payments')}>
          Payment requests
        </button>
      </div>

      {loading ? <Spinner label="Loading seller payment records" /> : activeItems.length === 0 ? (
        <div className="empty-state payment-empty-state">
          {tab === 'payments' ? <CreditCard size={25} /> : <CheckCircle2 size={25} />}
          <h3>{tab === 'pending' ? 'No pending closings' : tab === 'history' ? 'No completed closings yet' : 'No payment requests yet'}</h3>
          <p>{tab === 'pending'
            ? 'A completed simulated payment will create a closing for seller confirmation.'
            : tab === 'history'
              ? 'Completed demo closings will appear here.'
              : 'Payment requests created after winner approval will appear here.'}</p>
        </div>
      ) : (
        <div className="payment-card-list">
          {tab === 'payments' ? (payments.map((payment) => (
            <article className="payment-card" key={payment.id}>
              <div className="payment-card-main">
                <FallbackImage src={payment.property.images[0] ?? ''} alt={payment.property.title} />
                <div className="payment-card-info">
                  <div className="payment-card-title-row">
                    <div><h3>{payment.property.title}</h3><p className="subtle">{payment.property.city}, {payment.property.state}</p></div>
                    <PaymentStatusBadge status={payment.status} />
                  </div>
                  <div className="payment-summary-grid">
                    <span><strong>Accepted bid amount</strong>{formatInr(payment.amount)}</span>
                    <span><strong>Transaction reference</strong><code>{payment.transactionReference}</code></span>
                    <span><strong>Created</strong>{formatDate(payment.createdAt)}</span>
                  </div>
                  <p className="demo-disclaimer">Simulated demo payment · no buyer identity or credentials are displayed.</p>
                </div>
              </div>
            </article>
          ))) : (
            (tab === 'pending' ? pendingClosings : completedClosings).map((closing) => {
              const eligibleToConfirm = closing.status === 'PENDING'
                && closing.paymentStatus === 'SUCCESS'
                && closing.property.status === 'APPROVED'
              return (
                <article className="payment-card" key={closing.id}>
                  <div className="payment-card-main">
                    <FallbackImage src={closing.property.images[0] ?? ''} alt={closing.property.title} />
                    <div className="payment-card-info">
                      <div className="payment-card-title-row">
                        <div><h3>{closing.property.title}</h3><p className="subtle">{closing.property.city}, {closing.property.state}</p></div>
                        <PaymentStatusBadge status={closing.status} />
                      </div>
                      <div className="payment-summary-grid">
                        <span><strong>Accepted bid amount</strong>{formatInr(closing.amount)}</span>
                        <span><strong>Payment status</strong><PaymentStatusBadge status={closing.paymentStatus} /></span>
                        <span><strong>Closing created</strong>{formatDate(closing.createdAt)}</span>
                        <span><strong>Property status</strong>{closing.property.status.toLowerCase()}</span>
                      </div>
                      <p className="subtle">Demo transaction reference: <code>{closing.transactionReference}</code></p>
                      <p className="demo-disclaimer">Confirmation records a demo closing only. It does not transfer legal property title.</p>
                      {eligibleToConfirm && (
                        <div className="payment-card-actions">
                          <button className="btn btn-primary btn-small" type="button" onClick={() => setConfirming(closing)}>
                            <ShieldCheck size={14} />Confirm demo closing
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </article>
              )
            })
          )}
        </div>
      )}

      <PaymentPagination
        page={activePage}
        hasMore={activeHasMore}
        busy={refreshing}
        onChange={changePage}
      />

      {confirming && (
        <div className="payment-dialog-backdrop">
          <section className="payment-confirmation-dialog" role="dialog" aria-modal="true" aria-labelledby="closing-confirm-title">
            <span className="eyebrow">Seller confirmation</span>
            <h3 id="closing-confirm-title">Complete this demo closing?</h3>
            <p>This records the simulated sale closing for <strong>{confirming.property.title}</strong>. It is not a real payment, legal transfer, or title-registration action.</p>
            {error && <div className="error-box" role="alert">{error}</div>}
            <div className="payment-card-actions">
              <button className="btn btn-outline btn-small" type="button" disabled={busyId === confirming.id} onClick={() => setConfirming(null)}>Keep pending</button>
              <button className="btn btn-primary btn-small" type="button" disabled={busyId === confirming.id} onClick={() => void completeClosing()}>
                {busyId === confirming.id ? 'Confirming…' : 'Confirm demo closing'}
              </button>
            </div>
          </section>
        </div>
      )}
    </section>
  )
}
