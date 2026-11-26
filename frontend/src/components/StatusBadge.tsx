import type { PropertyStatus } from '../types'

export function StatusBadge({ status }: { status: PropertyStatus }) {
  const className = status === 'PENDING' ? 'status-pending' : status === 'APPROVED' ? 'status-approved' : status === 'REJECTED' ? 'status-rejected' : 'status-other'
  return <span className={`status ${className}`}>{status.toLowerCase()}</span>
}
