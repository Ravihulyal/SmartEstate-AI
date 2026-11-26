import { useEffect, useState } from 'react'
import { BedDouble, Heart, MapPin, Ruler, ShowerHead } from 'lucide-react'
import { Link, useParams } from 'react-router-dom'
import { Spinner } from '../components/Spinner'
import { getProperty } from '../services/properties'
import { getErrorMessage } from '../services/api'
import { getFavoriteIds, toggleFavoriteId } from '../services/favorites'
import { notify } from '../services/toast'
import type { Property } from '../types'
import { formatPropertyType } from '../services/propertyFormat'

function currency(value: number | null): string {
  return value === null ? 'Contact for price' : new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(value)
}

export function PropertyDetailsPage() {
  const { id = '' } = useParams()
  const [property, setProperty] = useState<Property | null>(null)
  const [favoriteIds, setFavoriteIds] = useState(getFavoriteIds)
  const [loadedId, setLoadedId] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    getProperty(id)
      .then((result) => { if (active) { setProperty(result); setError('') } })
      .catch((requestError: unknown) => { if (active) setError(getErrorMessage(requestError, 'This property could not be found.')) })
      .finally(() => { if (active) setLoadedId(id) })
    return () => { active = false }
  }, [id])

  function saveFavorite() {
    const favorites = toggleFavoriteId(id)
    setFavoriteIds(favorites)
    notify(favorites.includes(id) ? 'Saved to your favorites.' : 'Removed from saved homes.')
  }

  if (loadedId !== id) return <main className="page-wrap"><div className="container"><Spinner label="Loading property details" /></div></main>
  if (error || !property) return <main className="page-wrap"><div className="container"><div className="error-box" role="alert">{error || 'Property not found.'}</div><Link className="btn btn-outline" style={{ marginTop: 18 }} to="/dashboard">Back to discovery</Link></div></main>
  const isRent = property.listingType === 'RENT'
  const favorite = favoriteIds.includes(id)

  return (
    <main className="page-wrap">
      <div className="container">
        <Link to="/dashboard" className="subtle" style={{ display: 'inline-block', marginBottom: 20 }}>← Back to homes</Link>
        <div className="detail-grid">
          <div>
            <div className="detail-image">{property.images[0] ? <img src={property.images[0]} alt={property.title} /> : <Ruler size={38} />}</div>
            <section className="panel" style={{ marginTop: 20 }}>
              <h2>About this property</h2>
              <p className="detail-description">{property.description}</p>
            </section>
          </div>
          <aside className="detail-panel">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span className="property-tag" style={{ position: 'static', background: '#eef4ed' }}>{isRent ? 'For rent' : 'For sale'}</span>
              <button className={`favorite-button ${favorite ? 'is-favorite' : ''}`} style={{ position: 'static', border: '1px solid #e8ece8' }} onClick={saveFavorite} aria-label={favorite ? 'Remove from saved homes' : 'Save this home'} aria-pressed={favorite}><Heart size={17} fill={favorite ? 'currentColor' : 'none'} /></button>
            </div>
            <h1>{property.title}</h1>
            <div className="property-location"><MapPin size={15} />{property.location}, {property.city}, {property.state}</div>
            <div className="detail-price">{currency(isRent ? property.rentPerMonth : property.price)}{isRent && <span style={{ fontSize: 13, color: '#748078', fontWeight: 500 }}> / month</span>}</div>
            {!isRent && property.predictedPriceLakhs !== null && <div className="ai-estimate" style={{ marginTop: 15 }}>AI estimated sale price<strong>₹{property.predictedPriceLakhs.toLocaleString('en-IN', { maximumFractionDigits: 2 })} Lakhs</strong><span className="label-note">Informational estimate only; not a guaranteed market value.</span></div>}
            <div className="property-facts" style={{ padding: '18px 0', marginTop: 18, borderBottom: '1px solid #edf0ed', flexWrap: 'wrap' }}>
              <span><BedDouble size={16} />{property.bhk} bedrooms</span>
              <span><ShowerHead size={16} />{property.bathrooms} bathrooms</span>
              <span><Ruler size={16} />{property.totalSqft.toLocaleString('en-IN')} sqft</span>
            </div>
            <div style={{ marginTop: 19 }}>
              <div className="subtle" style={{ fontSize: 12 }}>Property type</div><strong>{formatPropertyType(property.propertyType)}</strong>
              <div className="subtle" style={{ fontSize: 12, marginTop: 15 }}>Listed by</div><strong>{property.seller?.name ?? 'SmartEstate seller'}</strong>
            </div>
            <p className="label-note" style={{ marginTop: 22 }}>Listing status is approved. Contact details are not available through the current backend API.</p>
          </aside>
        </div>
      </div>
    </main>
  )
}
