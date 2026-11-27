import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowLeft, Gavel } from 'lucide-react'
import { AuctionManagementPanel } from '../components/AuctionManagementPanel'
import { Spinner } from '../components/Spinner'
import { getErrorMessage } from '../services/api'
import { createAuction } from '../services/auctions'
import { getMyListings } from '../services/properties'
import type { Property } from '../types'

function localDateTime(date: Date): string {
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
}

function initialStartTime(): string {
  const start = new Date()
  start.setHours(start.getHours() + 1, 0, 0, 0)
  return localDateTime(start)
}

function initialEndTime(): string {
  const end = new Date()
  end.setHours(end.getHours() + 25, 0, 0, 0)
  return localDateTime(end)
}

export function SellerAuctionPage() {
  const navigate = useNavigate()
  const [properties, setProperties] = useState<Property[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [propertyId, setPropertyId] = useState('')
  const [startPrice, setStartPrice] = useState('')
  const [startTime, setStartTime] = useState(initialStartTime)
  const [endTime, setEndTime] = useState(initialEndTime)
  const submissionInProgress = useRef(false)

  useEffect(() => {
    let active = true
    getMyListings()
      .then((result) => { if (active) setProperties(result.properties.filter((property) => property.status === 'APPROVED')) })
      .catch((requestError: unknown) => { if (active) setError(getErrorMessage(requestError, 'Your approved properties could not be loaded.')) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submissionInProgress.current || submitting) return
    setError('')
    const numericPrice = Number(startPrice)
    if (!Number.isFinite(numericPrice) || numericPrice <= 0) {
      setError('Enter a valid starting price.')
      return
    }
    const startsAt = new Date(startTime)
    const endsAt = new Date(endTime)
    if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime()) || endsAt <= startsAt) {
      setError('Choose a valid end time after the start time.')
      return
    }

    submissionInProgress.current = true
    setSubmitting(true)
    try {
      const auction = await createAuction({
        propertyId,
        startPrice: numericPrice,
        startTime: startsAt.toISOString(),
        endTime: endsAt.toISOString(),
      })
      navigate(`/auctions/${encodeURIComponent(auction.id)}`)
    } catch (requestError: unknown) {
      setError(getErrorMessage(requestError, 'Auction could not be created.'))
    } finally {
      submissionInProgress.current = false
      setSubmitting(false)
    }
  }

  return (
    <main className="page-wrap">
      <div className="container">
        <Link to="/seller" className="subtle"><ArrowLeft size={15} /> Back to seller dashboard</Link>
        <div className="page-heading" style={{ marginTop: 18 }}><div><span className="eyebrow">Seller workspace</span><h1 className="page-title">Create an auction</h1><p className="subtle">Only your approved properties can be auctioned. Each property can have one auction.</p></div></div>
        <section className="form-card auction-create-card">
          <h2><Gavel size={19} />Auction details</h2>
          {error && <div className="error-box" role="alert">{error}</div>}
          {loading ? <Spinner label="Loading approved properties" /> : properties.length === 0 ? (
            <div className="empty-state"><h3>No approved properties available</h3><p>Submit a property and wait for approval before creating an auction.</p></div>
          ) : (
            <form className="form-grid" onSubmit={(event) => void submit(event)}>
              <div className="field field-wide"><label htmlFor="auction-property">Approved property</label><select id="auction-property" value={propertyId} onChange={(event) => setPropertyId(event.target.value)} required><option value="">Select a property</option>{properties.map((property) => <option key={property.id} value={property.id}>{property.title} — {property.city}</option>)}</select></div>
              <div className="field"><label htmlFor="auction-start-price">Starting price (INR)</label><input id="auction-start-price" type="number" min="0.01" step="0.01" value={startPrice} onChange={(event) => setStartPrice(event.target.value)} required /></div>
              <div className="field"><label htmlFor="auction-start-time">Start time</label><input id="auction-start-time" type="datetime-local" value={startTime} onChange={(event) => setStartTime(event.target.value)} required /></div>
              <div className="field"><label htmlFor="auction-end-time">End time</label><input id="auction-end-time" type="datetime-local" value={endTime} onChange={(event) => setEndTime(event.target.value)} required /></div>
              <p className="label-note field-wide">Bids must meet the starting price and each later bid must exceed the current highest bid. No configurable minimum increment is stored for this auction model.</p>
              <div className="form-actions field-wide"><button className="btn btn-primary" type="submit" disabled={submitting}>{submitting ? 'Creating auction…' : 'Create auction'}</button></div>
            </form>
          )}
        </section>
        <AuctionManagementPanel mode="SELLER" />
      </div>
    </main>
  )
}
