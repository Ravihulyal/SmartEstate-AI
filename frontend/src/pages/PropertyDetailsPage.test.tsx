// Runtime validation coverage for the buyer property photo gallery.
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PropertyDetailsPage } from './PropertyDetailsPage'

const mocks = vi.hoisted(() => ({
  addFavorite: vi.fn(),
  getFavorites: vi.fn(),
  getProperty: vi.fn(),
  removeFavorite: vi.fn(),
  buyer: { id: 'buyer-1', role: 'BUYER' as const },
}))

vi.mock('../services/properties', () => ({ getProperty: mocks.getProperty }))
vi.mock('../services/favorites', () => ({
  addFavorite: mocks.addFavorite,
  getFavorites: mocks.getFavorites,
  removeFavorite: mocks.removeFavorite,
}))
vi.mock('../services/api', () => ({
  getErrorMessage: (_error: unknown, fallback: string) => fallback,
}))
vi.mock('../hooks/authContext', () => ({
  useAuth: () => ({ user: mocks.buyer, loading: false }),
}))

describe('PropertyDetailsPage gallery', () => {
  beforeEach(() => {
    localStorage.clear()
    mocks.getFavorites.mockResolvedValue({ count: 0, properties: [] })
    mocks.addFavorite.mockResolvedValue({ id: 'property-1' })
    mocks.removeFavorite.mockResolvedValue(undefined)
    mocks.getProperty.mockResolvedValue({
      id: 'property-1',
      title: 'Garden home',
      description: 'A well-maintained property.',
      location: 'Green Park',
      city: 'Bengaluru',
      state: 'Karnataka',
      propertyType: 'HOUSE',
      listingType: 'RENT',
      totalSqft: 1200,
      bhk: 2,
      bathrooms: 2,
      price: null,
      rentPerMonth: 35000,
      predictedPriceLakhs: null,
      images: [
        'https://res.cloudinary.com/demo/image/upload/first.jpg',
        'https://res.cloudinary.com/demo/image/upload/second.jpg',
      ],
      status: 'APPROVED',
      sellerId: 'seller-1',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      seller: { id: 'seller-1', name: 'Seller' },
    })
  })

  afterEach(() => cleanup())

  it('displays the uploaded gallery images and switches the main photo', async () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/properties/property-1']}>
        <Routes>
          <Route path="/properties/:id" element={<PropertyDetailsPage />} />
        </Routes>
      </MemoryRouter>,
    )

    await waitFor(() => expect(mocks.getProperty).toHaveBeenCalledWith('property-1'))
    const mainImage = await screen.findByRole('img', { name: 'Garden home' })
    expect(mainImage.getAttribute('src')).toContain('first.jpg')
    expect(screen.getByRole('img', { name: 'Property photo 1' })).toBeTruthy()
    expect(screen.getByRole('img', { name: 'Property photo 2' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Show property photo 2' }))
    await waitFor(() => expect(container.querySelector('.detail-image img')?.getAttribute('src')).toContain('second.jpg'))

    fireEvent.error(container.querySelector('.detail-image img')!)
    expect(await screen.findByText('Image unavailable')).toBeTruthy()
  })

  it('loads the buyer saved state and adds and removes a favorite through the API', async () => {
    render(
      <MemoryRouter initialEntries={['/properties/property-1']}>
        <Routes>
          <Route path="/properties/:id" element={<PropertyDetailsPage />} />
        </Routes>
      </MemoryRouter>,
    )

    const addButton = await screen.findByRole('button', { name: 'Save this home' })
    expect(mocks.getFavorites).toHaveBeenCalledOnce()
    fireEvent.click(addButton)
    await waitFor(() => expect(mocks.addFavorite).toHaveBeenCalledWith('property-1'))
    const removeButton = await screen.findByRole('button', { name: 'Remove from saved homes' })
    fireEvent.click(removeButton)
    await waitFor(() => expect(mocks.removeFavorite).toHaveBeenCalledWith('property-1'))
    expect(await screen.findByRole('button', { name: 'Save this home' })).toBeTruthy()
  })
})
