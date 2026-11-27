import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { ClipboardList, CreditCard, RefreshCw, ShieldCheck } from 'lucide-react'
import { PaymentPagination } from './PaymentPagination'
import { PaymentStatusBadge } from './PaymentStatusBadge'
import { Spinner } from './Spinner'
import { usePaymentNotifications } from '../hooks/usePaymentNotifications'
import { getErrorMessage } from '../services/api'
import { getAdminAuctions } from '../services/auctions'
import {
  getAdminClosings,
  getAdminPaymentAudit,
  getAdminPayments,
  type AuditPageQuery,
} from '../services/payments'
import type {
  AdminPayment,
  Auction,
  PaymentAuditEntry,
  PaymentStatus,
  SaleClosing,
  SaleClosingStatus,
} from '../types'

type AdminTab = 'payments' | 'closings' | 'audit'

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

export function AdminPaymentMonitoringPanel() {
  const [tab, setTab] = useState<AdminTab>('payments')
  const [payments, setPayments] = useState<AdminPayment[]>([])
  const [closings, setClosings] = useState<SaleClosing[]>([])
  const [audit, setAudit] = useState<PaymentAuditEntry[]>([])
  const [pendingApprovals, setPendingApprovals] = useState<Auction[]>([])
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus | ''>('')
  const [closingStatus, setClosingStatus] = useState<SaleClosingStatus | ''>('')
  const [auditForm, setAuditForm] = useState<AuditPageQuery>({})
  const [auditFilters, setAuditFilters] = useState<AuditPageQuery>({})
  const [paymentPage, setPaymentPage] = useState(1)
  const [closingPage, setClosingPage] = useState(1)
  const [auditPage, setAuditPage] = useState(1)
  const [paymentHasMore, setPaymentHasMore] = useState(false)
  const [closingHasMore, setClosingHasMore] = useState(false)
  const [auditHasMore, setAuditHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')

  const loadData = useCallback(() => Promise.all([
    getAdminPayments({ page: paymentPage, limit: 10, ...(paymentStatus ? { status: paymentStatus } : {}) }),
    getAdminClosings({ page: closingPage, limit: 10, ...(closingStatus ? { status: closingStatus } : {}) }),
    getAdminPaymentAudit({ ...auditFilters, page: auditPage, limit: 10 }),
    getAdminAuctions(),
  ]), [auditFilters, auditPage, closingPage, closingStatus, paymentPage, paymentStatus])

  const refresh = useCallback(async () => {
    setRefreshing(true)
    setError('')
    try {
      const [paymentResult, closingResult, auditResult, auctionResult] = await loadData()
      setPayments(paymentResult.payments)
      setPaymentHasMore(paymentResult.pagination.hasMore)
      setClosings(closingResult.closings)
      setClosingHasMore(closingResult.pagination.hasMore)
      setAudit(auditResult.audit)
      setAuditHasMore(auditResult.pagination.hasMore)
      setPendingApprovals(auctionResult.auctions.filter((auction) => auction.outcomeStatus === 'PENDING_SELLER_APPROVAL'))
    } catch (requestError: unknown) {
      setError(getErrorMessage(requestError, 'Admin payment monitoring data could not be loaded.'))
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [loadData])

  useEffect(() => {
    let active = true
    loadData()
      .then(([paymentResult, closingResult, auditResult, auctionResult]) => {
        if (!active) return
        setPayments(paymentResult.payments)
        setPaymentHasMore(paymentResult.pagination.hasMore)
        setClosings(closingResult.closings)
        setClosingHasMore(closingResult.pagination.hasMore)
        setAudit(auditResult.audit)
        setAuditHasMore(auditResult.pagination.hasMore)
        setPendingApprovals(auctionResult.auctions.filter((auction) => auction.outcomeStatus === 'PENDING_SELLER_APPROVAL'))
      })
      .catch((requestError: unknown) => {
        if (active) setError(getErrorMessage(requestError, 'Admin payment monitoring data could not be loaded.'))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => { active = false }
  }, [loadData])

  usePaymentNotifications(refresh)

  function applyAuditFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmed = {
      ...(auditForm.auctionId?.trim() ? { auctionId: auditForm.auctionId.trim() } : {}),
      ...(auditForm.paymentId?.trim() ? { paymentId: auditForm.paymentId.trim() } : {}),
      ...(auditForm.saleClosingId?.trim() ? { saleClosingId: auditForm.saleClosingId.trim() } : {}),
    }
    setAuditFilters(trimmed)
    setAuditPage(1)
  }

  const activeItems = tab === 'payments' ? payments : tab === 'closings' ? closings : audit
  const activePage = tab === 'payments' ? paymentPage : tab === 'closings' ? closingPage : auditPage
  const activeHasMore = tab === 'payments' ? paymentHasMore : tab === 'closings' ? closingHasMore : auditHasMore
  const changePage = tab === 'payments' ? setPaymentPage : tab === 'closings' ? setClosingPage : setAuditPage

  return (
    <section id="transactions" className="demo-workflow-panel">
      <div className="section-head demo-workflow-heading">
        <div>
          <span className="eyebrow">Administration · read-only</span>
          <h2>Payment &amp; closing monitor</h2>
          <p className="subtle">Inspect simulated payment, closing and audit records. Admins cannot approve payments or complete seller closings.</p>
        </div>
        <button className="btn btn-outline btn-small" type="button" onClick={() => void refresh()} disabled={refreshing}>
          <RefreshCw size={15} />{refreshing ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      <p className="demo-disclaimer">Demo records only · no payment gateway, real money, or buyer credentials.</p>
      {error && <div className="error-box" role="alert">{error}</div>}

      <section className="admin-pending-approvals" aria-labelledby="admin-pending-approval-heading">
        <div className="section-head">
          <div><span className="eyebrow">Monitoring</span><h3 id="admin-pending-approval-heading">Awaiting seller decisions ({pendingApprovals.length})</h3></div>
        </div>
        {loading ? <Spinner label="Loading seller decision monitor" /> : pendingApprovals.length === 0 ? (
          <p className="subtle">No completed auctions are awaiting seller decisions.</p>
        ) : (
          <ul className="admin-pending-approval-list">
            {pendingApprovals.map((auction) => (
              <li key={auction.id}>
                <strong>{auction.property.title}</strong>
                <span>{auction.winningBid ? formatInr(String(auction.winningBid.amount)) : 'Highest bid unavailable'}</span>
                <span>Ended {formatDate(auction.endTime)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="payment-tabs" role="tablist" aria-label="Admin transaction views">
        <button type="button" role="tab" aria-selected={tab === 'payments'} onClick={() => setTab('payments')}><CreditCard size={14} />Payments</button>
        <button type="button" role="tab" aria-selected={tab === 'closings'} onClick={() => setTab('closings')}><ShieldCheck size={14} />Closings</button>
        <button type="button" role="tab" aria-selected={tab === 'audit'} onClick={() => setTab('audit')}><ClipboardList size={14} />Audit history</button>
      </div>

      {tab === 'payments' && (
        <div className="payment-filter">
          <label htmlFor="admin-payment-status">Payment status</label>
          <select id="admin-payment-status" value={paymentStatus} onChange={(event) => {
            setPaymentStatus(event.target.value as PaymentStatus | '')
            setPaymentPage(1)
          }}>
            <option value="">All statuses</option>
            <option value="PENDING">Pending</option>
            <option value="SUCCESS">Success</option>
            <option value="FAILED">Failed</option>
            <option value="EXPIRED">Expired</option>
          </select>
        </div>
      )}
      {tab === 'closings' && (
        <div className="payment-filter">
          <label htmlFor="admin-closing-status">Closing status</label>
          <select id="admin-closing-status" value={closingStatus} onChange={(event) => {
            setClosingStatus(event.target.value as SaleClosingStatus | '')
            setClosingPage(1)
          }}>
            <option value="">All statuses</option>
            <option value="PENDING">Pending</option>
            <option value="COMPLETED">Completed</option>
            <option value="CANCELLED">Cancelled</option>
          </select>
        </div>
      )}
      {tab === 'audit' && (
        <form className="payment-audit-filters" onSubmit={applyAuditFilters}>
          <div className="field"><label htmlFor="audit-auction-id">Auction ID</label><input id="audit-auction-id" value={auditForm.auctionId ?? ''} onChange={(event) => setAuditForm((current) => ({ ...current, auctionId: event.target.value }))} /></div>
          <div className="field"><label htmlFor="audit-payment-id">Payment ID</label><input id="audit-payment-id" value={auditForm.paymentId ?? ''} onChange={(event) => setAuditForm((current) => ({ ...current, paymentId: event.target.value }))} /></div>
          <div className="field"><label htmlFor="audit-closing-id">Closing ID</label><input id="audit-closing-id" value={auditForm.saleClosingId ?? ''} onChange={(event) => setAuditForm((current) => ({ ...current, saleClosingId: event.target.value }))} /></div>
          <button className="btn btn-outline btn-small" type="submit">Apply audit filters</button>
        </form>
      )}

      {loading ? <Spinner label={`Loading admin ${tab}`} /> : activeItems.length === 0 ? (
        <div className="empty-state payment-empty-state">
          <ClipboardList size={25} />
          <h3>No {tab === 'audit' ? 'audit records' : tab} found</h3>
          <p>Records will appear here as the simulated payment workflow is used.</p>
        </div>
      ) : (
        <div className="payment-card-list">
          {tab === 'payments' && payments.map((payment) => (
            <AdminPaymentCard key={payment.id} payment={payment} />
          ))}
          {tab === 'closings' && closings.map((closing) => (
            <AdminClosingCard key={closing.id} closing={closing} />
          ))}
          {tab === 'audit' && audit.map((entry) => (
            <AdminAuditCard key={entry.id} entry={entry} />
          ))}
        </div>
      )}

      <PaymentPagination page={activePage} hasMore={activeHasMore} busy={refreshing} onChange={changePage} />
    </section>
  )
}

function AdminPaymentCard({ payment }: { payment: AdminPayment }) {
  return (
    <article className="payment-card admin-transaction-card">
      <div className="payment-card-title-row">
        <div>
          <h3>{payment.property.title}</h3>
          <p className="subtle">{payment.property.city}, {payment.property.state}</p>
        </div>
        <PaymentStatusBadge status={payment.status} />
      </div>
      <div className="payment-summary-grid">
        <span><strong>Amount</strong>{formatInr(payment.amount)}</span>
        <span><strong>Payment reference</strong><code>{payment.transactionReference}</code></span>
        <span><strong>Created</strong>{formatDate(payment.createdAt)}</span>
        <span><strong>Paid at</strong>{formatDate(payment.paidAt)}</span>
        <span><strong>Auction outcome</strong>{payment.auctionOutcomeStatus?.toLowerCase().replaceAll('_', ' ') ?? 'Not available'}</span>
        <span><strong>Closing status</strong>{payment.saleClosingStatus?.toLowerCase() ?? 'Not created'}</span>
      </div>
      <p className="demo-disclaimer">SIMULATED · not a real payment.</p>
    </article>
  )
}

function AdminClosingCard({ closing }: { closing: SaleClosing }) {
  return (
    <article className="payment-card admin-transaction-card">
      <div className="payment-card-title-row">
        <div>
          <h3>{closing.property.title}</h3>
          <p className="subtle">{closing.property.city}, {closing.property.state}</p>
        </div>
        <PaymentStatusBadge status={closing.status} />
      </div>
      <div className="payment-summary-grid">
        <span><strong>Amount</strong>{formatInr(closing.amount)}</span>
        <span><strong>Payment status</strong><PaymentStatusBadge status={closing.paymentStatus} /></span>
        <span><strong>Transaction reference</strong><code>{closing.transactionReference}</code></span>
        <span><strong>Created</strong>{formatDate(closing.createdAt)}</span>
        <span><strong>Completed</strong>{formatDate(closing.completedAt)}</span>
        <span><strong>Property status</strong>{closing.property.status.toLowerCase()}</span>
      </div>
    </article>
  )
}

function AdminAuditCard({ entry }: { entry: PaymentAuditEntry }) {
  return (
    <article className="payment-card admin-transaction-card">
      <div className="payment-card-title-row">
        <div><h3>{entry.action.replaceAll('_', ' ').toLowerCase()}</h3><p className="subtle">{formatDate(entry.createdAt)} · {entry.adminId ? `Admin ID ${entry.adminId}` : 'Workflow record'}</p></div>
      </div>
      <div className="payment-summary-grid">
        <span><strong>Auction</strong><code>{entry.auctionId}</code></span>
        {entry.paymentId && <span><strong>Payment</strong><code>{entry.paymentId}</code></span>}
        {entry.saleClosingId && <span><strong>Closing</strong><code>{entry.saleClosingId}</code></span>}
        {entry.sellerId && <span><strong>Related seller ID</strong><code>{entry.sellerId}</code></span>}
        {entry.buyerId && <span><strong>Related buyer ID</strong><code>{entry.buyerId}</code></span>}
        {entry.reason && <span><strong>Reason</strong>{entry.reason}</span>}
      </div>
    </article>
  )
}
