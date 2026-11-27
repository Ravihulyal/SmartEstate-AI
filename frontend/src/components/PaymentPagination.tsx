import { ChevronLeft, ChevronRight } from 'lucide-react'

export function PaymentPagination({
  page,
  hasMore,
  busy,
  onChange,
}: {
  page: number
  hasMore: boolean
  busy: boolean
  onChange: (page: number) => void
}) {
  if (page === 1 && !hasMore) return null

  return (
    <nav className="payment-pagination" aria-label="Transaction pages">
      <button className="btn btn-outline btn-small" type="button" disabled={busy || page <= 1} onClick={() => onChange(page - 1)}>
        <ChevronLeft size={15} />Previous
      </button>
      <span className="subtle">Page {page}</span>
      <button className="btn btn-outline btn-small" type="button" disabled={busy || !hasMore} onClick={() => onChange(page + 1)}>
        Next<ChevronRight size={15} />
      </button>
    </nav>
  )
}
