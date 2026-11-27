import { useCallback, useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { Building2, ImagePlus, Pencil, Plus, RotateCcw, Trash2, Upload } from 'lucide-react'
import { Link } from 'react-router-dom'
import {
  createProperty,
  deletePropertyImage,
  getMyListings,
  MAX_PROPERTY_IMAGE_BYTES,
  MAX_PROPERTY_IMAGES,
  propertyTypeOptions,
  updateProperty,
  uploadPropertyImages
} from '../services/properties'
import { getErrorMessage } from '../services/api'
import { notify } from '../services/toast'
import { StatusBadge } from '../components/StatusBadge'
import { Spinner } from '../components/Spinner'
import { FallbackImage } from '../components/FallbackImage'
import { AuctionManagementPanel } from '../components/AuctionManagementPanel'
import { PendingWinnerApprovalPanel } from '../components/PendingWinnerApprovalPanel'
import { SellerClosingPanel } from '../components/SellerClosingPanel'
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
}

const emptyForm: FormState = {
  title: '', description: '', location: '', city: '', state: 'Karnataka',
  propertyType: 'APARTMENT', listingType: 'SALE', totalSqft: '', bhk: '2',
  bathrooms: '2', price: '', rentPerMonth: '',
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
  }
}

function toPayload(form: FormState, images: string[]): PropertyPayload {
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

function LocalImagePreview({ file }: { file: File }) {
  const imageRef = useRef<HTMLImageElement>(null)
  const [failedFile, setFailedFile] = useState<File | null>(null)

  useEffect(() => {
    const objectUrl = URL.createObjectURL(file)
    const image = imageRef.current
    if (image) image.src = objectUrl
    return () => {
      URL.revokeObjectURL(objectUrl)
      image?.removeAttribute('src')
    }
  }, [file])

  if (failedFile === file) return <FallbackImage src="" alt={`Selected ${file.name}`} />
  return <img ref={imageRef} alt={`Selected ${file.name}`} onError={() => setFailedFile(file)} />
}

function formatPrice(property: Property): string {
  const amount = property.listingType === 'SALE' ? property.price : property.rentPerMonth
  if (amount === null) return 'Price unavailable'
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(amount)
}

function isManagedCloudinaryImage(url: string): boolean {
  try {
    const parsedUrl = new URL(url)
    return parsedUrl.protocol === 'https:' &&
      parsedUrl.hostname === 'res.cloudinary.com' &&
      parsedUrl.pathname.includes('/upload/') &&
      parsedUrl.pathname.includes('/smartestate/properties/')
  } catch {
    return false
  }
}

export function SellerDashboard() {
  const [listings, setListings] = useState<Property[]>([])
  const [form, setForm] = useState<FormState>(emptyForm)
  const [editing, setEditing] = useState<Property | null>(null)
  const [selectedFiles, setSelectedFiles] = useState<File[]>([])
  const [uploadedImages, setUploadedImages] = useState<string[]>([])
  const [imagesPendingDelete, setImagesPendingDelete] = useState<string[]>([])
  const [uploadingImages, setUploadingImages] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [removingImage, setRemovingImage] = useState('')
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [listingsError, setListingsError] = useState('')
  const uploadInProgress = useRef(false)
  const submissionInProgress = useRef(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    setListingsError('')
    try {
      const result = await getMyListings()
      setListings(result.properties)
    } catch (requestError: unknown) {
      setListingsError(getErrorMessage(requestError, 'Your listings could not be loaded.'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    let active = true
    getMyListings()
      .then((result) => { if (active) setListings(result.properties) })
      .catch((requestError: unknown) => { if (active) setListingsError(getErrorMessage(requestError, 'Your listings could not be loaded.')) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])

  function startEdit(property: Property) {
    setEditing(property)
    setForm(formFromProperty(property))
    setUploadedImages(property.images)
    setSelectedFiles([])
    setImagesPendingDelete([])
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function resetForm(discardNewUploads = true) {
    if (discardNewUploads) {
      const newUploads = uploadedImages.filter((url) => !editing?.images.includes(url))
      const results = await Promise.allSettled(newUploads.map((url) => deletePropertyImage(url)))
      if (results.some((result) => result.status === 'rejected')) {
        notify('The form was cleared, but one or more uploaded images could not be removed from storage.', 'error')
      }
    }
    setEditing(null)
    setForm(emptyForm)
    setSelectedFiles([])
    setUploadedImages([])
    setImagesPendingDelete([])
    setUploadProgress(0)
  }

  function selectImages(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.currentTarget.files ?? [])
    event.currentTarget.value = ''
    const valid: File[] = []
    let validationMessage = ''

    for (const file of files) {
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
        validationMessage = 'Choose JPEG, PNG, or WebP images only.'
        continue
      }
      if (file.size > MAX_PROPERTY_IMAGE_BYTES) {
        validationMessage = 'Each image must be 5 MB or smaller.'
        continue
      }
      if (uploadedImages.length + selectedFiles.length + valid.length >= MAX_PROPERTY_IMAGES) {
        validationMessage = `A property can have up to ${MAX_PROPERTY_IMAGES} images.`
        break
      }
      valid.push(file)
    }

    setError(validationMessage)
    if (valid.length) setSelectedFiles((current) => [...current, ...valid])
  }

  async function uploadSelectedImages() {
    if (!selectedFiles.length || uploadInProgress.current || submissionInProgress.current) return
    uploadInProgress.current = true
    setUploadingImages(true)
    setUploadProgress(0)
    setError('')
    try {
      const secureUrls = await uploadPropertyImages(selectedFiles, setUploadProgress)
      setUploadedImages((current) => [...current, ...secureUrls])
      setSelectedFiles([])
      notify(`${secureUrls.length} image${secureUrls.length === 1 ? '' : 's'} uploaded securely.`)
    } catch (requestError: unknown) {
      setError(getErrorMessage(requestError, 'Images could not be uploaded. Please try again.'))
    } finally {
      uploadInProgress.current = false
      setUploadingImages(false)
      setUploadProgress(0)
    }
  }

  async function removeUploadedImage(secureUrl: string) {
    if (editing?.images.includes(secureUrl)) {
      setUploadedImages((current) => current.filter((url) => url !== secureUrl))
      if (isManagedCloudinaryImage(secureUrl)) {
        setImagesPendingDelete((current) => [...current, secureUrl])
      }
      return
    }

    setRemovingImage(secureUrl)
    setError('')
    try {
      await deletePropertyImage(secureUrl)
      setUploadedImages((current) => current.filter((url) => url !== secureUrl))
      notify('Image removed.')
    } catch (requestError: unknown) {
      setError(getErrorMessage(requestError, 'Image could not be removed.'))
    } finally {
      setRemovingImage('')
    }
  }

  function removeSelectedImage(index: number) {
    setSelectedFiles((current) => current.filter((_file, fileIndex) => fileIndex !== index))
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    if (submissionInProgress.current || submitting) return
    if (uploadInProgress.current) {
      setError('Wait for the selected images to finish uploading before submitting.')
      return
    }
    if (selectedFiles.length) {
      setError('Upload your selected images before submitting the property.')
      return
    }
    if (uploadedImages.length > MAX_PROPERTY_IMAGES) {
      setError(`A property can have up to ${MAX_PROPERTY_IMAGES} images.`)
      return
    }
    submissionInProgress.current = true
    setSubmitting(true)
    try {
      const payload = toPayload(form, uploadedImages)
      const result = editing ? await updateProperty(editing.id, payload) : await createProperty(payload)
      const prediction = result.predictedPriceLakhs
      notify(editing ? 'Listing updated and resubmitted for approval.' : 'Property submitted for approval.')
      if (form.listingType === 'SALE' && prediction !== null) {
        notify(`AI estimated sale price: ₹${prediction.toLocaleString('en-IN')} Lakhs. This is not a guaranteed market value.`)
      }
      if (imagesPendingDelete.length) {
        const deletionResults = await Promise.allSettled(imagesPendingDelete.map((url) => deletePropertyImage(url)))
        if (deletionResults.some((deletion) => deletion.status === 'rejected')) {
          notify('The listing was saved, but one or more removed images could not be deleted from storage.', 'error')
        }
      }
      await resetForm(false)
      await refresh()
    } catch (requestError: unknown) {
      setError(getErrorMessage(requestError, 'The property could not be saved. Please try again.'))
    } finally {
      submissionInProgress.current = false
      setSubmitting(false)
    }
  }

  return (
    <main className="page-wrap">
      <div className="container">
        <div className="page-heading">
          <div><span className="eyebrow">Seller workspace</span><h1 className="page-title">Manage your listings</h1><p className="subtle">Submit a property and follow it through the review process.</p></div>
          <div className="seller-dashboard-actions"><Link className="btn btn-outline" to="/seller/auctions/new">Create auction</Link><div className="stat-card" style={{ minWidth: 140 }}><span className="stat-label">Your listings</span><strong className="stat-value">{listings.length}</strong></div></div>
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
                <div className="field field-wide">
                  <label htmlFor="property-images">Property images ({uploadedImages.length + selectedFiles.length}/{MAX_PROPERTY_IMAGES})</label>
                  <div className="image-upload-actions">
                    <label className="btn btn-outline btn-small" htmlFor="property-images"><ImagePlus size={15} />Choose images</label>
                    <input
                      id="property-images"
                      className="file-input-hidden"
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      multiple
                      onChange={selectImages}
                      disabled={uploadingImages || submitting || uploadedImages.length + selectedFiles.length >= MAX_PROPERTY_IMAGES}
                    />
                    <button className="btn btn-primary btn-small" type="button" onClick={() => void uploadSelectedImages()} disabled={!selectedFiles.length || uploadingImages || submitting}>
                      <Upload size={14} />{uploadingImages ? `Uploading ${uploadProgress}%` : `Upload ${selectedFiles.length || ''} selected`}
                    </button>
                  </div>
                  <span className="label-note">JPEG, PNG, or WebP · up to 5 MB each · no more than {MAX_PROPERTY_IMAGES} images. Upload images before submitting.</span>
                  {uploadingImages && <progress className="upload-progress" max="100" value={uploadProgress} aria-label={`Image upload ${uploadProgress}% complete`} />}
                  {(uploadedImages.length > 0 || selectedFiles.length > 0) && (
                    <div className="image-upload-grid">
                      {uploadedImages.map((url) => (
                        <div className="image-upload-item" key={url}>
                          <FallbackImage src={url} alt="Uploaded property" />
                          <span className="image-upload-label">{editing?.images.includes(url) ? 'Current image' : 'Uploaded'}</span>
                          <button type="button" aria-label="Remove uploaded image" onClick={() => void removeUploadedImage(url)} disabled={removingImage === url || uploadingImages || submitting}><Trash2 size={14} /></button>
                        </div>
                      ))}
                      {selectedFiles.map((file, index) => (
                        <div className="image-upload-item" key={`${file.name}-${file.size}-${file.lastModified}-${index}`}>
                          <LocalImagePreview file={file} />
                          <span className="image-upload-label">Selected</span>
                          <button type="button" aria-label={`Remove ${file.name}`} onClick={() => removeSelectedImage(index)} disabled={uploadingImages || submitting}><Trash2 size={14} /></button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <div className="form-actions">
                <button className="btn btn-primary" type="submit" disabled={submitting || uploadingImages}>{submitting ? 'Saving…' : editing ? 'Save changes & resubmit' : 'Submit for approval'}</button>
                {editing && <button className="btn btn-outline" type="button" onClick={() => void resetForm()} disabled={submitting || uploadingImages}><RotateCcw size={15} />Cancel edit</button>}
              </div>
              {form.listingType === 'SALE' && <p className="label-note" style={{ marginTop: 14 }}>Sale submissions are automatically evaluated by the AI service. Estimates are informational only and are stored in lakhs of INR.</p>}
            </form>
          </section>
          <section>
            <div className="section-head" style={{ marginBottom: 15 }}><div><h2 style={{ fontFamily: 'Georgia,serif', fontWeight: 500 }}>Your submissions</h2><p style={{ margin: '5px 0 0', fontSize: 13 }}>Listings can be edited while pending or after rejection.</p></div><Building2 size={21} color="#557761" /></div>
            {loading ? <Spinner label="Loading your listings" /> : listingsError && !listings.length ? <div className="error-box" role="alert">{listingsError}</div> : !listings.length ? <div className="empty-state"><Building2 size={26} /><h3>No listings yet</h3><p>Your submitted properties will appear here.</p></div> : (
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
        <PendingWinnerApprovalPanel />
        <SellerClosingPanel onClosingCompleted={refresh} />
        <AuctionManagementPanel mode="SELLER" />
      </div>
    </main>
  )
}
