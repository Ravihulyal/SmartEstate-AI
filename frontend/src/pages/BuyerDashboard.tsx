import { useEffect, useMemo, useRef, useState } from 'react'
import { Heart, SlidersHorizontal } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import { PropertyGrid } from '../components/PropertyGrid'
import { BuyerPaymentsPanel } from '../components/BuyerPaymentsPanel'
import { addFavorite, getFavorites, removeFavorite } from '../services/favorites'
import { getProperties } from '../services/properties'
import { getErrorMessage } from '../services/api'
import type { ListingType, Property, PropertyFilters, PropertyType } from '../types'
import { notify } from '../services/toast'

export function BuyerDashboard() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [city, setCity] = useState(() => searchParams.get('city') ?? '')
  const [listingType, setListingType] = useState<ListingType | ''>('')
  const [propertyType, setPropertyType] = useState<PropertyType | ''>('')
  const [bhk, setBhk] = useState<number | ''>('')
  const [savedProperties, setSavedProperties] = useState<Property[]>([])
  const [favoritesLoading, setFavoritesLoading] = useState(true)
  const [favoritesLoaded, setFavoritesLoaded] = useState(false)
  const [favoritesRetry, setFavoritesRetry] = useState(0)
  const [favoritesError, setFavoritesError] = useState('')
  const [favoritePendingId, setFavoritePendingId] = useState('')
  const [favoritesOnly, setFavoritesOnly] = useState(false)
  const [properties, setProperties] = useState<Property[]>([])
  const [loadedFilters, setLoadedFilters] = useState('')
  const [error, setError] = useState('')
  const favoriteRequestInProgress = useRef(false)

  const filters = useMemo<PropertyFilters>(() => ({ city, listingType, propertyType, bhk }), [city, listingType, propertyType, bhk])
  const favorites = useMemo(() => savedProperties.map((property) => property.id), [savedProperties])

  useEffect(() => {
    let active = true
    getProperties(filters)
      .then((result) => { if (active) { setProperties(result.properties); setError(''); setLoadedFilters(JSON.stringify(filters)) } })
      .catch((requestError: unknown) => { if (active) { setError(getErrorMessage(requestError, 'Properties could not be loaded.')); setLoadedFilters(JSON.stringify(filters)) } })
    return () => { active = false }
  }, [filters])

  useEffect(() => {
    let active = true
    getFavorites()
      .then((result) => {
        if (active) {
          setSavedProperties(result.properties)
          setFavoritesLoaded(true)
          setFavoritesError('')
        }
      })
      .catch((requestError: unknown) => {
        if (active) setFavoritesError(getErrorMessage(requestError, 'Your saved homes could not be loaded.'))
      })
      .finally(() => { if (active) setFavoritesLoading(false) })
    return () => { active = false }
  }, [favoritesRetry])

  const loading = loadedFilters !== JSON.stringify(filters)
  const visibleProperties = favoritesOnly ? savedProperties : properties

  async function toggleFavorite(id: string) {
    if (favoriteRequestInProgress.current) return
    favoriteRequestInProgress.current = true
    setFavoritePendingId(id)
    setFavoritesError('')
    try {
      if (favorites.includes(id)) {
        await removeFavorite(id)
        setSavedProperties((current) => current.filter((property) => property.id !== id))
        notify('Removed from saved homes.')
      } else {
        const property = await addFavorite(id)
        setSavedProperties((current) => current.some((saved) => saved.id === id) ? current : [property, ...current])
        notify('Saved to your favorites.')
      }
    } catch (requestError: unknown) {
      setFavoritesError(getErrorMessage(requestError, 'Your saved homes could not be updated.'))
    } finally {
      favoriteRequestInProgress.current = false
      setFavoritePendingId('')
    }
  }

  function clearFilters() {
    setCity('')
    setListingType('')
    setPropertyType('')
    setBhk('')
    setFavoritesOnly(false)
    setSearchParams({})
  }

  return (
    <main className="page-wrap">
      <div className="container">
        <div className="page-heading">
          <div><span className="eyebrow">Your home search</span><h1 className="page-title">Discover your next home</h1><p className="subtle mt-2 text-sm">Explore approved listings and find the place that feels right.</p></div>
          <button className={`btn ${favoritesOnly ? 'btn-primary' : 'btn-outline'}`} onClick={() => setFavoritesOnly((value) => !value)} disabled={favoritesLoading}><Heart size={16} fill={favoritesOnly ? 'currentColor' : 'none'} />Saved homes ({favoritesLoading ? '…' : favorites.length})</button>
        </div>
        <BuyerPaymentsPanel />
        <div className="dashboard-layout">
          <aside className="filter-panel">
            <h3><SlidersHorizontal size={16} style={{ verticalAlign: 'middle', marginRight: 7 }} />Filters</h3>
            <div className="filter-fields-mobile">
              <div className="filter-field"><label htmlFor="city">City</label><input id="city" placeholder="e.g. Bengaluru" value={city} onChange={(event) => { setCity(event.target.value); setSearchParams(event.target.value ? { city: event.target.value } : {}) }} /></div>
              <div className="filter-field"><label htmlFor="listingType">Looking to</label><select id="listingType" value={listingType} onChange={(event) => setListingType(event.target.value as ListingType | '')}><option value="">Buy or rent</option><option value="SALE">Buy</option><option value="RENT">Rent</option></select></div>
              <div className="filter-field"><label htmlFor="propertyType">Property type</label><select id="propertyType" value={propertyType} onChange={(event) => setPropertyType(event.target.value as PropertyType | '')}><option value="">All types</option><option value="APARTMENT">Apartment</option><option value="VILLA">Villa</option><option value="HOUSE">House</option><option value="PLOT">Plot</option><option value="COMMERCIAL">Commercial</option></select></div>
              <div className="filter-field"><label htmlFor="bhk">Bedrooms</label><select id="bhk" value={bhk} onChange={(event) => setBhk(event.target.value ? Number(event.target.value) : '')}><option value="">Any</option><option value="1">1 BHK</option><option value="2">2 BHK</option><option value="3">3 BHK</option><option value="4">4 BHK</option></select></div>
            </div>
            <button className="btn btn-quiet btn-small" style={{ marginTop: 16, paddingLeft: 0 }} onClick={clearFilters}>Clear filters</button>
          </aside>
          <section aria-label="Available properties">
            <div className="section-head" style={{ marginBottom: 17 }}>
              <div><strong>{loading ? 'Searching…' : `${visibleProperties.length} ${visibleProperties.length === 1 ? 'home' : 'homes'}`}</strong><span className="subtle" style={{ fontSize: 13 }}> available to explore</span></div>
            </div>
            {favoritesError && (favoritesLoaded || !favoritesOnly) && <div className="error-box" role="alert" style={{ marginBottom: 14 }}>{favoritesError}</div>}
            {favoritesOnly && favoritesLoading ? <div className="loading-inline"><span className="spinner" />Loading saved homes…</div>
              : favoritesOnly && !favoritesLoaded ? (
                <div className="error-box" role="alert">
                  {favoritesError || 'Your saved homes could not be loaded.'}
                  <button
                    className="btn btn-outline btn-small"
                    style={{ marginLeft: 10 }}
                    onClick={() => {
                      setFavoritesError('')
                      setFavoritesLoaded(false)
                      setFavoritesLoading(true)
                      setFavoritesRetry((retry) => retry + 1)
                    }}
                    disabled={favoritesLoading}
                  >
                    Try again
                  </button>
                </div>
              )
              : error && !favoritesOnly ? <div className="error-box" role="alert">{error}</div>
                : loading && !favoritesOnly ? <div className="loading-inline"><span className="spinner" />Loading approved properties…</div>
                  : (
                    <PropertyGrid
                      properties={visibleProperties}
                      favorites={favorites}
                      favoritePendingId={favoritePendingId}
                      favoritesDisabled={!favoritesLoaded || favoritesLoading}
                      onFavorite={toggleFavorite}
                      emptyTitle={favoritesOnly ? 'No saved homes yet' : 'No matching properties'}
                      emptyMessage={favoritesOnly ? 'Tap the heart on a property to save it here.' : 'Adjust your filters or try another city.'}
                    />
                  )}
          </section>
        </div>
      </div>
    </main>
  )
}
