import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Building2, Pencil, Plus, RotateCcw } from 'lucide-react'
import { getMyListings, createProperty, updateProperty, propertyTypeOptions } from '../services/properties'
import { getErrorMessage } from '../services/api'
import { notify } from '../services/toast'
import { StatusBadge } from '../components/StatusBadge'
import { Spinner } from '../components/Spinner'
import type { ListingType, Property, PropertyPayload, PropertyType } from '../types'

interface FormState {
  title: string
  description: string
  location: string
  city: string
  state: string
  propertyType: PropertyType
  listingType: ListingType
  totalSqft: string
  bhk: string
  bathrooms: string
  price: string
  rentPerMonth: string
  images: string
}

const emptyForm: FormState = {
  title: '', description: '', location: '', city: '', state: 'Karnataka',
  propertyType: 'APARTMENT', listingType: 'SALE', totalSqft: '', bhk: '2',
  bathrooms: '2', price: '', rentPerMonth: '', images: '',
}

function formFromProperty(property: Property): FormState {
  return {
    title: property.title,
    description: property.description,
    location: property.location,
    city: property.city,
    state: property.state,
    propertyType: property.propertyType,
    listingType: property.listingType,
    totalSqft: String(property.totalSqft),
    bhk: String(property.bhk),
    bathrooms: String(property.bathrooms),
    price: property.price === null ? '' : String(property.price),
    rentPerMonth: property.rentPerMonth === null ? '' : String(property.rentPerMonth),
    images: property.images.join(', '),
  }
}

function toPayload(form: FormState): PropertyPayload {
  const images = form.images.split(',').map((url) => url.trim()).filter(Boolean)
  return {
    title: form.title.trim(),
    description: form.description.trim(),
    location: form.location.trim(),
    city: form.city.trim(),
    state: form.state.trim(),
    propertyType: form.propertyType,
    listingType: form.listingType,
    totalSqft: Number(form.totalSqft),
    bhk: Number(form.bhk),
    bathrooms: Number(form.bathrooms),
    ...(form.listingType === 'SALE' ? { price: Number(form.price) } : { rentPerMonth: Number(form.rentPerMonth) }),
    images,
  }
}

function formatPrice(property: Property): string {
  const amount = property.listingType === 'SALE' ? property.price : property.rentPerMonth
  if (amount === null) return 'Price unavailable'
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(amount)
}

export function SellerDashboard() {
  const [listings, setListings] = useState<Property[]>([])
  const [form, setForm] = useState<FormState>(emptyForm)
  const [editing, setEditing] = useState<Property | null>(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const refresh = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const result = await getMyListings()
      setListings(result.properties)
    } catch (requestError: unknown) {
      setError(getErrorMessage(requestError, 'Your listings could not be loaded.'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    let active = true
    getMyListings()
      .then((result) => { if (active) setListings(result.properties) })
      .catch((requestError: unknown) => { if (active) setError(getErrorMessage(requestError, 'Your listings could not be loaded.')) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])

  function startEdit(property: Property) {
    setEditing(property)
    setForm(formFromProperty(property))
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function resetForm() {
    setEditing(null)
    setForm(emptyForm)
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    const images = form.images.split(',').map((url) => url.trim()).filter(Boolean)
    if (images.some((url) => {
      try { return !['http:', 'https:'].includes(new URL(url).protocol) } catch { return true }
    })) {
      setError('Each property image must be a complete http or https URL.')
      return
    }
    setSubmitting(true)
    try {
      const payload = toPayload(form)
      const result = editing ? await updateProperty(editing.id, payload) : await createProperty(payload)
      const prediction = result.predictedPriceLakhs
      notify(editing ? 'Listing updated and resubmitted for approval.' : 'Property submitted for approval.')
      if (form.listingType === 'SALE' && prediction !== null) {
        notify(`AI estimated sale price: ₹${prediction.toLocaleString('en-IN')} Lakhs. This is not a guaranteed market value.`)
      }
      resetForm()
      await refresh()
    } catch (requestError: unknown) {
      setError(getErrorMessage(requestError, 'The property could not be saved. Please try again.'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="page-wrap">
      <div className="container">
        <div className="page-heading">
          <div><span className="eyebrow">Seller workspace</span><h1 className="page-title">Manage your listings</h1><p className="subtle">Submit a property and follow it through the review process.</p></div>
          <div className="stat-card" style={{ minWidth: 140 }}><span className="stat-label">Your listings</span><strong className="stat-value">{listings.length}</strong></div>
        </div>
        <div className="dashboard-layout" style={{ gridTemplateColumns: 'minmax(0,1.05fr) minmax(0,.95fr)' }}>
          <section className="form-card">
            <h2>{editing ? <><Pencil size={17} style={{ verticalAlign: 'middle', marginRight: 7 }} />Edit listing</> : <><Plus size={18} style={{ verticalAlign: 'middle', marginRight: 7 }} />Add a property</>}</h2>
            <form onSubmit={submit}>
              {error && <div className="error-box" role="alert" style={{ marginBottom: 16 }}>{error}</div>}
              <div className="form-grid">
                <div className="field field-wide"><label htmlFor="title">Property title</label><input id="title" minLength={5} maxLength={150} required value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="e.g. Sunlit 2-bedroom apartment" /></div>
                <div className="field field-wide"><label htmlFor="description">Description</label><textarea id="description" minLength={10} maxLength={5000} required value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="Describe the property and what makes it special…" /></div>
                <div className="field"><label htmlFor="location">Neighbourhood</label><input id="location" minLength={2} required value={form.location} onChange={(event) => setForm({ ...form, location: event.target.value })} /></div>
                <div className="field"><label htmlFor="city">City</label><input id="city" minLength={2} required value={form.city} onChange={(event) => setForm({ ...form, city: event.target.value })} /></div>
                <div className="field"><label htmlFor="state">State</label><input id="state" minLength={2} required value={form.state} onChange={(event) => setForm({ ...form, state: event.target.value })} /></div>
                <div className="field"><label htmlFor="propertyType">Property type</label><select id="propertyType" value={form.propertyType} onChange={(event) => setForm({ ...form, propertyType: event.target.value as PropertyType })}>{propertyTypeOptions.map((option) => <option key={option} value={option}>{option.charAt(0) + option.slice(1).toLowerCase()}</option>)}</select></div>
                <div className="field"><label htmlFor="listingType">Listing type</label><select id="listingType" value={form.listingType} onChange={(event) => setForm({ ...form, listingType: event.target.value as ListingType })}><option value="SALE">For sale</option><option value="RENT">For rent</option></select></div>
                <div className="field"><label htmlFor="totalSqft">Total area (sqft)</label><input id="totalSqft" type="number" min="1" step="any" required value={form.totalSqft} onChange={(event) => setForm({ ...form, totalSqft: event.target.value })} /></div>
                <div className="field"><label htmlFor="bhk">Bedrooms (BHK)</label><input id="bhk" type="number" min="1" step="1" required value={form.bhk} onChange={(event) => setForm({ ...form, bhk: event.target.value })} /></div>
                <div className="field"><label htmlFor="bathrooms">Bathrooms</label><input id="bathrooms" type="number" min="1" step="1" required value={form.bathrooms} onChange={(event) => setForm({ ...form, bathrooms: event.target.value })} /></div>
                {form.listingType === 'SALE' ? (
                  <div className="field"><label htmlFor="price">Asking price (INR)</label><input id="price" type="number" min="1" step="any" required value={form.price} onChange={(event) => setForm({ ...form, price: event.target.value })} /><span className="label-note">The AI estimate is returned in lakhs; this is your asking price in rupees.</span></div>
                ) : (
                  <div className="field"><label htmlFor="rentPerMonth">Monthly rent (INR)</label><input id="rentPerMonth" type="number" min="1" step="any" required value={form.rentPerMonth} onChange={(event) => setForm({ ...form, rentPerMonth: event.target.value })} /></div>
                )}
                <div className="field field-wide"><label htmlFor="images">Image URLs (optional)</label><input id="images" type="text" value={form.images} onChange={(event) => setForm({ ...form, images: event.target.value })} placeholder="https://… (separate multiple URLs with commas)" /><span className="label-note">Images need to be publicly reachable http/https URLs.</span></div>
              </div>
              <div className="form-actions">
                <button className="btn btn-primary" type="submit" disabled={submitting}>{submitting ? 'Saving…' : editing ? 'Save changes & resubmit' : 'Submit for approval'}</button>
                {editing && <button className="btn btn-outline" type="button" onClick={resetForm}><RotateCcw size={15} />Cancel edit</button>}
              </div>
              {form.listingType === 'SALE' && <p className="label-note" style={{ marginTop: 14 }}>Sale submissions are automatically evaluated by the AI service. Estimates are informational only and are stored in lakhs of INR.</p>}
            </form>
          </section>
          <section>
            <div className="section-head" style={{ marginBottom: 15 }}><div><h2 style={{ fontFamily: 'Georgia,serif', fontWeight: 500 }}>Your submissions</h2><p style={{ margin: '5px 0 0', fontSize: 13 }}>Listings can be edited while pending or after rejection.</p></div><Building2 size={21} color="#557761" /></div>
            {loading ? <Spinner label="Loading your listings" /> : error && !listings.length ? <div className="error-box" role="alert">{error}</div> : !listings.length ? <div className="empty-state"><Building2 size={26} /><h3>No listings yet</h3><p>Your submitted properties will appear here.</p></div> : (
              <div className="listings">
                {listings.map((property) => (
                  <article className="listing-row" key={property.id}>
                    <div className="listing-thumb">{property.images[0] ? <img src={property.images[0]} alt="" /> : <Building2 size={22} />}</div>
                    <div><h3>{property.title}</h3><div className="listing-meta">{property.city} · {formatPrice(property)}</div>{property.listingType === 'SALE' && property.predictedPriceLakhs !== null && <div className="listing-meta" style={{ color: '#356547', marginTop: 5 }}>AI estimate: ₹{property.predictedPriceLakhs.toLocaleString('en-IN', { maximumFractionDigits: 2 })} Lakhs</div>}</div>
                    <div className="listing-end"><StatusBadge status={property.status} />{['PENDING', 'REJECTED'].includes(property.status) && <button className="btn btn-outline btn-small" onClick={() => startEdit(property)}><Pencil size={13} />Edit</button>}</div>
                  </article>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </main>
  )
}
