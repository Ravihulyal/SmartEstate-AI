import type { PaymentStatus, SaleClosingStatus } from '../types'

type WorkflowStatus = PaymentStatus | SaleClosingStatus

export function PaymentStatusBadge({ status }: { status: WorkflowStatus }) {
  return <span className={`payment-status payment-status-${status.toLowerCase()}`}>{status.replaceAll('_', ' ').toLowerCase()}</span>
}
