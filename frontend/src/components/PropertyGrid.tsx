import { SearchX } from 'lucide-react'
import type { Property } from '../types'
import { PropertyCard } from './PropertyCard'

export function PropertyGrid({ properties, favorites, favoritePendingId, favoritesDisabled = false, onFavorite, emptyTitle = 'No properties found', emptyMessage = 'Try adjusting your filters or check back soon.' }: {
  properties: Property[]
  favorites?: string[]
  favoritePendingId?: string
  favoritesDisabled?: boolean
  onFavorite?: (id: string) => void
  emptyTitle?: string
  emptyMessage?: string
}) {
  if (!properties.length) {
    return <div className="empty-state"><SearchX size={27} /><h3>{emptyTitle}</h3><p>{emptyMessage}</p></div>
  }
  return <div className="property-grid">{properties.map((property) => (
    <PropertyCard
      key={property.id}
      property={property}
      favorite={favorites?.includes(property.id)}
      favoritePending={favoritesDisabled || favoritePendingId === property.id}
      onFavorite={onFavorite}
    />
  ))}</div>
}
