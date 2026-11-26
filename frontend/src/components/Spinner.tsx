export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="loading-wrap" role="status" aria-live="polite">
      <div className="loading-inline"><span className="spinner" aria-hidden="true" />{label}</div>
    </div>
  )
}
