import { useEffect, useRef, useState } from 'react'
import { BedDouble, Heart, MapPin, Ruler, ShowerHead } from 'lucide-react'
import { Link, useParams } from 'react-router-dom'
import { Spinner } from '../components/Spinner'
import { getProperty } from '../services/properties'
import { getErrorMessage } from '../services/api'
import { addFavorite, getFavorites, removeFavorite } from '../services/favorites'
import { notify } from '../services/toast'
import type { Property, User } from '../types'
import { formatPropertyType } from '../services/propertyFormat'
import { FallbackImage } from '../components/FallbackImage'
import { useAuth } from '../hooks/authContext'

function currency(value: number | null): string {
  return value === null ? 'Contact for price' : new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(value)
}

export function PropertyDetailsPage() {
  const { id = '' } = useParams()
  const { user, loading: authLoading } = useAuth()
  const [property, setProperty] = useState<Property | null>(null)
  const [favoriteIds, setFavoriteIds] = useState<string[]>([])
  const [favoritesLoadedFor, setFavoritesLoadedFor] = useState<User | null>(null)
  const [favoritesErrorState, setFavoritesErrorState] = useState<{ user: User; message: string } | null>(null)
  const [favoritePending, setFavoritePending] = useState(false)
  const [activeImageUrl, setActiveImageUrl] = useState('')
  const [loadedId, setLoadedId] = useState('')
  const [error, setError] = useState('')
  const favoriteRequestInProgress = useRef(false)

  useEffect(() => {
    let active = true
    getProperty(id)
      .then((result) => { if (active) { setProperty(result); setActiveImageUrl(result.images[0] ?? ''); setError('') } })
      .catch((requestError: unknown) => { if (active) setError(getErrorMessage(requestError, 'This property could not be found.')) })
      .finally(() => { if (active) setLoadedId(id) })
    return () => { active = false }
  }, [id])

  useEffect(() => {
    let active = true
    if (user?.role === 'BUYER') {
      getFavorites()
        .then((result) => {
          if (active) {
            setFavoriteIds(result.properties.map((favorite) => favorite.id))
            setFavoritesLoadedFor(user)
            setFavoritesErrorState(null)
          }
        })
        .catch((requestError: unknown) => {
          if (active) {
            setFavoriteIds([])
            setFavoritesErrorState({
              user,
              message: getErrorMessage(requestError, 'Your saved status could not be loaded.')
            })
            setFavoritesLoadedFor(user)
          }
        })
    }
    return () => { active = false }
  }, [user])

  async function saveFavorite() {
    if (favoriteRequestInProgress.current || user?.role !== 'BUYER') return
    favoriteRequestInProgress.current = true
    setFavoritePending(true)
    setFavoritesErrorState(null)
    try {
      if (favoriteIds.includes(id)) {
        await removeFavorite(id)
        setFavoriteIds((current) => current.filter((favoriteId) => favoriteId !== id))
        notify('Removed from saved homes.')
      } else {
        await addFavorite(id)
        setFavoriteIds((current) => current.includes(id) ? current : [...current, id])
        notify('Saved to your favorites.')
      }
    } catch (requestError: unknown) {
      setFavoritesErrorState({
        user,
        message: getErrorMessage(requestError, 'Your saved homes could not be updated.')
      })
    } finally {
      favoriteRequestInProgress.current = false
      setFavoritePending(false)
    }
  }

  if (loadedId !== id) return <main className="page-wrap"><div className="container"><Spinner label="Loading property details" /></div></main>
  if (error || !property) return <main className="page-wrap"><div className="container"><div className="error-box" role="alert">{error || 'Property not found.'}</div><Link className="btn btn-outline" style={{ marginTop: 18 }} to="/dashboard">Back to discovery</Link></div></main>
  const isRent = property.listingType === 'RENT'
  const favorite = favoritesLoadedFor === user && favoriteIds.includes(id)
  const favoritesLoading = user?.role === 'BUYER' && favoritesLoadedFor !== user
  const favoritesError = favoritesErrorState?.user === user ? favoritesErrorState.message : ''

  return (
    <main className="page-wrap">
      <div className="container">
        <Link to="/dashboard" className="subtle" style={{ display: 'inline-block', marginBottom: 20 }}>← Back to homes</Link>
        <div className="detail-grid">
          <div>
            <div className="detail-image">{activeImageUrl ? <FallbackImage src={activeImageUrl} alt={property.title} /> : <Ruler size={38} />}</div>
            {property.images.length > 1 && (
              <div className="image-gallery-thumbs" aria-label="Property photo gallery">
                {property.images.map((image, index) => (
                  <button
                    className={image === activeImageUrl ? 'gallery-thumb gallery-thumb-active' : 'gallery-thumb'}
                    key={image}
                    type="button"
                    onClick={() => setActiveImageUrl(image)}
                    aria-label={`Show property photo ${index + 1}`}
                    aria-pressed={image === activeImageUrl}
                  >
                    <FallbackImage src={image} alt={`Property photo ${index + 1}`} />
                  </button>
                ))}
              </div>
            )}
            <section className="panel" style={{ marginTop: 20 }}>
              <h2>About this property</h2>
              <p className="detail-description">{property.description}</p>
            </section>
          </div>
          <aside className="detail-panel">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span className="property-tag" style={{ position: 'static', background: '#eef4ed' }}>{isRent ? 'For rent' : 'For sale'}</span>
              {user?.role === 'BUYER' ? (
                <button
                  className={`favorite-button ${favorite ? 'is-favorite' : ''}`}
                  style={{ position: 'static', border: '1px solid #e8ece8' }}
                  onClick={() => void saveFavorite()}
                  aria-label={favorite ? 'Remove from saved homes' : 'Save this home'}
                  aria-pressed={favorite}
                  disabled={favoritesLoading || favoritePending}
                >
                  <Heart size={17} fill={favorite ? 'currentColor' : 'none'} />
                </button>
              ) : !authLoading ? <Link className="btn btn-outline btn-small" to="/login">Sign in to save</Link> : null}
            </div>
            {favoritesError && <div className="error-box" role="alert" style={{ marginTop: 12 }}>{favoritesError}</div>}
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
