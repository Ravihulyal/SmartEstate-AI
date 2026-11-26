import { useEffect, useState, type FormEvent } from 'react'
import { ArrowRight, BadgeCheck, Bot, Search, ShieldCheck, Sparkles } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { PropertyGrid } from '../components/PropertyGrid'
import { getProperties } from '../services/properties'
import { getErrorMessage } from '../services/api'
import type { Property } from '../types'
import { useAuth } from '../hooks/authContext'

export function HomePage() {
  const [properties, setProperties] = useState<Property[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [city, setCity] = useState('')
  const navigate = useNavigate()
  const { user } = useAuth()

  useEffect(() => {
    getProperties()
      .then((result) => setProperties(result.properties.slice(0, 3)))
      .catch((requestError: unknown) => setError(getErrorMessage(requestError, 'Featured properties could not be loaded.')))
      .finally(() => setLoading(false))
  }, [])

  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (user?.role === 'BUYER') {
      navigate(`/dashboard?city=${encodeURIComponent(city.trim())}`)
      return
    }
    setLoading(true)
    setError('')
    try {
      const result = await getProperties({ city: city.trim() })
      setProperties(result.properties.slice(0, 3))
      document.getElementById('discover')?.scrollIntoView({ behavior: 'smooth' })
    } catch (requestError: unknown) {
      setError(getErrorMessage(requestError, 'Properties could not be searched.'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <main>
      <section className="hero">
        <div className="container hero-grid">
          <div>
            <span className="eyebrow">A better way to find home</span>
            <h1>Find a place to <em>belong.</em></h1>
            <p className="hero-copy">Discover thoughtfully selected homes, make confident decisions, and find the right space for the life you want to build.</p>
            <form className="hero-search" onSubmit={search}>
              <Search size={19} color="#7c8a80" />
              <input aria-label="Search by city" placeholder="City or neighbourhood" value={city} onChange={(event) => setCity(event.target.value)} />
              <button className="btn btn-primary" type="submit">Explore <ArrowRight size={16} /></button>
            </form>
            <div style={{ display: 'flex', gap: 20, marginTop: 21, color: '#66766b', fontSize: 12, flexWrap: 'wrap' }}>
              <span><ShieldCheck size={15} style={{ verticalAlign: 'middle', marginRight: 5 }} />Reviewed listings</span>
              <span><Sparkles size={15} style={{ verticalAlign: 'middle', marginRight: 5 }} />AI-assisted estimates</span>
            </div>
          </div>
          <div className="hero-art" role="img" aria-label="Warm, modern living space">
            <div className="hero-note">
              <div><span className="eyebrow" style={{ color: '#e5eee7' }}>Your next chapter</span><br /><strong>Starts with a space.</strong></div>
              <span className="trust-pill"><BadgeCheck size={15} /> Built on trust</span>
            </div>
          </div>
        </div>
      </section>

      <section className="section" id="discover">
        <div className="container">
          <div className="section-head">
            <div><span className="eyebrow">Explore the collection</span><h2>Places worth coming home to</h2><p>Browse verified listings and discover the details that matter.</p></div>
            <Link to={!user ? '/register' : user.role === 'BUYER' ? '/dashboard' : '/#discover'} className="btn btn-outline">Browse all homes <ArrowRight size={15} /></Link>
          </div>
          {loading ? <div className="loading-inline"><span className="spinner" />Finding available homes…</div> : error ? <div className="error-box">{error}</div> : <PropertyGrid properties={properties} emptyTitle="New homes are on their way" emptyMessage="Approved listings will appear here as soon as they're available." />}
        </div>
      </section>

      <section className="section section-soft">
        <div className="container">
          <div className="section-head"><div><span className="eyebrow">Built for better decisions</span><h2>More confidence at every step</h2><p>Tools that help make property discovery feel a little less uncertain.</p></div></div>
          <div className="feature-grid">
            <article className="feature-card"><span className="feature-icon"><Bot size={21} /></span><h3>AI price estimates</h3><p>See an AI-generated sale price estimate in lakhs alongside a listing. It is an informative estimate, not a guaranteed market valuation.</p></article>
            <article className="feature-card"><span className="feature-icon"><ShieldCheck size={21} /></span><h3>Reviewed before publishing</h3><p>Seller submissions remain pending until an administrator reviews and approves them for public discovery.</p></article>
            <article className="feature-card"><span className="feature-icon"><Sparkles size={21} /></span><h3>Find what fits you</h3><p>Search approved homes by location, property type, bedrooms, and whether you want to buy or rent.</p></article>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <div className="section-head"><div><span className="eyebrow">Simple by design</span><h2>From search to your next move</h2></div></div>
          <div className="steps">
            <div className="step"><span className="step-number">01</span><div><h3>Discover</h3><p>Set your location and preferences to browse available, approved homes.</p></div></div>
            <div className="step"><span className="step-number">02</span><div><h3>Compare</h3><p>Review property details, costs, and estimated sale prices where available.</p></div></div>
            <div className="step"><span className="step-number">03</span><div><h3>Move forward</h3><p>Connect directly with the seller and take the next step on your terms.</p></div></div>
          </div>
        </div>
      </section>
    </main>
  )
}
