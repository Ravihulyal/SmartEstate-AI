import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Clock3, Gavel, MapPin } from 'lucide-react'
import { FallbackImage } from '../components/FallbackImage'
import { Spinner } from '../components/Spinner'
import { getAuctions } from '../services/auctions'
import { getErrorMessage } from '../services/api'
import type { Auction } from '../types'

function currency(amount: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2,
  }).format(amount)
}

function statusLabel(status: Auction['status']): string {
  return status === 'ACTIVE' ? 'Live now' : status === 'UPCOMING' ? 'Upcoming' : status === 'COMPLETED' ? 'Ended' : 'Cancelled'
}

export function AuctionListingPage() {
  const [auctions, setAuctions] = useState<Auction[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    getAuctions()
      .then((response) => { if (active) setAuctions(response.auctions) })
      .catch((requestError: unknown) => { if (active) setError(getErrorMessage(requestError, 'Auctions could not be loaded.')) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])

  return (
    <main className="page-wrap">
      <div className="container">
        <div className="page-heading">
          <div><span className="eyebrow">Live and upcoming</span><h1 className="page-title">Property auctions</h1><p className="subtle">Follow approved property auctions and place bids in real time.</p></div>
        </div>
        {loading ? <Spinner label="Loading auctions" /> : error ? <div className="error-box" role="alert">{error}</div> : auctions.length === 0 ? (
          <div className="empty-state"><Gavel size={27} /><h3>No auctions yet</h3><p>Approved property auctions will appear here.</p></div>
        ) : (
          <div className="property-grid auction-grid">
            {auctions.map((auction) => (
              <article className="auction-card" key={auction.id}>
                <Link className="auction-photo" to={`/auctions/${encodeURIComponent(auction.id)}`} aria-label={`View auction for ${auction.property.title}`}>
                  <FallbackImage src={auction.property.images[0] ?? ''} alt={auction.property.title} />
                  <span className={`auction-status auction-status-${auction.status.toLowerCase()}`}>{statusLabel(auction.status)}</span>
                </Link>
                <div className="auction-card-body">
                  <h2><Link to={`/auctions/${encodeURIComponent(auction.id)}`}>{auction.property.title}</Link></h2>
                  <p className="property-location"><MapPin size={15} />{auction.property.location}, {auction.property.city}</p>
                  <div className="auction-stat"><span>Starting price</span><strong>{currency(auction.startPrice)}</strong></div>
                  <div className="auction-stat"><span>{auction.currentBid === null ? 'Starting price · no bids yet' : 'Current highest bid'}</span><strong>{currency(auction.currentBid ?? auction.startPrice)}</strong></div>
                  <div className="auction-card-footer"><span><Clock3 size={14} />{auction.status === 'UPCOMING' ? 'Starts' : 'Ends'} {new Date(auction.status === 'UPCOMING' ? auction.startTime : auction.endTime).toLocaleString()}</span><Link className="btn btn-outline btn-small" to={`/auctions/${encodeURIComponent(auction.id)}`}>View auction</Link></div>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </main>
  )
}
