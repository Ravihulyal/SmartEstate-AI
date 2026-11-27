import { BedDouble, Heart, MapPin, MoveUpRight, Ruler } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { Property } from '../types'
import { formatPropertyType } from '../services/propertyFormat'
import { FallbackImage } from './FallbackImage'

function formatCurrency(value: number | null): string {
  if (value === null) return 'Price on request'
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(value)
}

export function PropertyCard({ property, favorite, favoritePending = false, onFavorite }: {
  property: Property
  favorite?: boolean
  favoritePending?: boolean
  onFavorite?: (id: string) => void
}) {
  const rental = property.listingType === 'RENT'
  return (
    <article className="property-card">
      <Link to={`/properties/${encodeURIComponent(property.id)}`} aria-label={`View ${property.title}`}>
        <div className="property-image">
          {property.images[0] ? <FallbackImage src={property.images[0]} alt={property.title} loading="lazy" /> : <div className="image-placeholder"><Ruler size={30} /><span>SmartEstate property</span></div>}
          <span className="property-tag">{rental ? 'For rent' : 'For sale'}</span>
        </div>
      </Link>
      {onFavorite && (
        <button className={`favorite-button ${favorite ? 'is-favorite' : ''}`} onClick={() => onFavorite(property.id)} aria-label={favorite ? 'Remove from favorites' : 'Add to favorites'} aria-pressed={favorite} disabled={favoritePending}>
          <Heart size={17} fill={favorite ? 'currentColor' : 'none'} />
        </button>
      )}
      <div className="property-card-body">
        <p className="property-price">{formatCurrency(rental ? property.rentPerMonth : property.price)}{rental && <span style={{ fontSize: 11, color: '#7a867d', fontWeight: 500 }}> / month</span>}</p>
        <Link to={`/properties/${encodeURIComponent(property.id)}`} className="property-title">{property.title}</Link>
        <p className="property-location"><MapPin size={14} />{property.location}, {property.city}</p>
        <div className="property-facts">
          <span><BedDouble size={15} />{property.bhk} beds</span>
          <span><Ruler size={14} />{property.totalSqft.toLocaleString('en-IN')} sqft</span>
          <span><MoveUpRight size={14} />{formatPropertyType(property.propertyType)}</span>
        </div>
        {!rental && property.predictedPriceLakhs !== null && (
          <div className="ai-estimate">AI estimated sale price<strong>₹{property.predictedPriceLakhs.toLocaleString('en-IN', { maximumFractionDigits: 2 })} Lakhs</strong></div>
        )}
      </div>
    </article>
  )
}
