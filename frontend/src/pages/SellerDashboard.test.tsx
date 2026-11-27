// Runtime validation coverage for seller image upload and submission flows.
// @vitest-environment jsdom
import { StrictMode } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SellerDashboard } from './SellerDashboard'

const mocks = vi.hoisted(() => ({
  createProperty: vi.fn(),
  deletePropertyImage: vi.fn(),
  getMyListings: vi.fn(),
  updateProperty: vi.fn(),
  uploadPropertyImages: vi.fn(),
  notify: vi.fn(),
}))

vi.mock('../services/properties', () => ({
  ...mocks,
  MAX_PROPERTY_IMAGE_BYTES: 5 * 1024 * 1024,
  MAX_PROPERTY_IMAGES: 6,
  propertyTypeOptions: ['APARTMENT', 'VILLA', 'HOUSE', 'PLOT', 'COMMERCIAL'],
}))

vi.mock('../services/api', () => ({
  getErrorMessage: (_error: unknown, fallback: string) => fallback,
}))

vi.mock('../services/toast', () => ({ notify: mocks.notify }))
vi.mock('../components/AuctionManagementPanel', () => ({ AuctionManagementPanel: () => null }))
vi.mock('../components/PendingWinnerApprovalPanel', () => ({ PendingWinnerApprovalPanel: () => null }))
vi.mock('../components/SellerClosingPanel', () => ({ SellerClosingPanel: () => null }))

const createObjectURL = vi.fn()
const revokeObjectURL = vi.fn()

function completeForm(listingType: 'SALE' | 'RENT') {
  fireEvent.change(screen.getByLabelText('Property title'), { target: { value: 'Sunny family home' } })
  fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'A spacious home near schools.' } })
  fireEvent.change(screen.getByLabelText('Neighbourhood'), { target: { value: 'Green Park' } })
  fireEvent.change(screen.getByLabelText('City'), { target: { value: 'Bengaluru' } })
  fireEvent.change(screen.getByLabelText('State'), { target: { value: 'Karnataka' } })
  fireEvent.change(screen.getByLabelText('Total area (sqft)'), { target: { value: '1200' } })
  fireEvent.change(screen.getByLabelText('Bedrooms (BHK)'), { target: { value: '2' } })
  fireEvent.change(screen.getByLabelText('Bathrooms'), { target: { value: '2' } })
  fireEvent.change(screen.getByLabelText('Listing type'), { target: { value: listingType } })
  fireEvent.change(
    screen.getByLabelText(listingType === 'SALE' ? 'Asking price (INR)' : 'Monthly rent (INR)'),
    { target: { value: listingType === 'SALE' ? '12000000' : '35000' } },
  )
}

describe('SellerDashboard image and property workflows', () => {
  beforeEach(() => {
    let nextUrl = 0
    createObjectURL.mockImplementation(() => `blob:property-preview-${nextUrl++}`)
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL })
    mocks.getMyListings.mockResolvedValue({ count: 0, properties: [] })
    mocks.uploadPropertyImages.mockReset()
    mocks.createProperty.mockReset()
    mocks.notify.mockReset()
  })

  afterEach(() => cleanup())

  it('previews JPEG and PNG files through upload, then submits their Cloudinary URLs for SALE', async () => {
    const jpeg = new File([new Uint8Array([0xff, 0xd8, 0xff])], 'front.jpg', { type: 'image/jpeg' })
    const png = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'garden.png', { type: 'image/png' })
    const secureUrls = [
      'https://res.cloudinary.com/demo/image/upload/smartestate/properties/seller/front.jpg',
      'https://res.cloudinary.com/demo/image/upload/smartestate/properties/seller/garden.png',
    ]
    let finishUpload: ((urls: string[]) => void) | undefined
    mocks.uploadPropertyImages.mockImplementation((_files, onProgress) => new Promise((resolve) => {
      finishUpload = resolve
      onProgress(35)
    }))
    let finishSubmission: ((result: { property: unknown; predictedPriceLakhs: number | null }) => void) | undefined
    mocks.createProperty.mockImplementation(() => new Promise((resolve) => {
      finishSubmission = resolve
    }))

    const { container } = render(<MemoryRouter><StrictMode><SellerDashboard /></StrictMode></MemoryRouter>)
    completeForm('SALE')
    fireEvent.change(screen.getByLabelText(/Property images/), { target: { files: [jpeg, png] } })

    const selectedPreviews = await screen.findAllByAltText(/Selected/)
    expect(selectedPreviews).toHaveLength(2)
    await waitFor(() => {
      expect(selectedPreviews.every((preview) => preview.getAttribute('src')?.startsWith('blob:'))).toBe(true)
    })
    const previewUrls = selectedPreviews.map((preview) => preview.getAttribute('src'))
    for (const preview of selectedPreviews) {
      expect(preview.getAttribute('src')).toMatch(/^blob:/)
      expect(revokeObjectURL).not.toHaveBeenCalledWith(preview.getAttribute('src'))
    }

    fireEvent.click(screen.getByRole('button', { name: 'Submit for approval' }))
    expect(await screen.findAllByText('Upload your selected images before submitting the property.')).toHaveLength(1)
    expect(mocks.createProperty).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Upload 2 selected' }))
    await waitFor(() => expect(mocks.uploadPropertyImages).toHaveBeenCalledWith([jpeg, png], expect.any(Function)))
    expect(screen.getByRole('progressbar', { name: 'Image upload 35% complete' })).toBeTruthy()
    expect(screen.getAllByAltText(/Selected/)).toHaveLength(2)

    await act(async () => finishUpload?.(secureUrls))
    await waitFor(() => expect(screen.getAllByAltText('Uploaded property')).toHaveLength(2))
    for (const previewUrl of previewUrls) expect(revokeObjectURL).toHaveBeenCalledWith(previewUrl)

    fireEvent.click(screen.getByRole('button', { name: 'Submit for approval' }))
    fireEvent.submit(container.querySelector('form')!)
    await waitFor(() => expect(mocks.createProperty).toHaveBeenCalledOnce())
    expect(screen.getByRole('button', { name: 'Saving…' }).hasAttribute('disabled')).toBe(true)
    expect(mocks.createProperty).toHaveBeenCalledWith(expect.objectContaining({
      listingType: 'SALE',
      price: 12000000,
      images: secureUrls,
    }))
    await act(async () => finishSubmission?.({ property: {}, predictedPriceLakhs: 115 }))
    await waitFor(() => expect(mocks.notify).toHaveBeenCalledWith(expect.stringContaining('AI estimated sale price')))
  }, 12_000)

  it('shows a fallback for an unreadable local image and submits RENT details', async () => {
    const jpeg = new File([new Uint8Array([0xff, 0xd8, 0xff])], 'unreadable.jpg', { type: 'image/jpeg' })
    mocks.createProperty.mockResolvedValue({ property: {}, predictedPriceLakhs: null })

    render(<MemoryRouter><StrictMode><SellerDashboard /></StrictMode></MemoryRouter>)
    completeForm('RENT')
    fireEvent.change(screen.getByLabelText(/Property images/), { target: { files: [jpeg] } })
    const preview = await screen.findByAltText('Selected unreadable.jpg')
    fireEvent.error(preview)
    expect(await screen.findByText('Image unavailable')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Remove unreadable.jpg' }))

    fireEvent.click(screen.getByRole('button', { name: 'Submit for approval' }))
    await waitFor(() => expect(mocks.createProperty).toHaveBeenCalledWith(expect.objectContaining({
      listingType: 'RENT',
      rentPerMonth: 35000,
      images: [],
    })))
    expect(mocks.notify).not.toHaveBeenCalledWith(expect.stringContaining('AI estimated sale price'))
  })
})
