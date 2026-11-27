// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Property } from '../types'
import { SellerAuctionPage } from './SellerAuctionPage'

const mocks = vi.hoisted(() => ({
  createAuction: vi.fn(),
  getMyListings: vi.fn(),
}))

vi.mock('../services/auctions', () => ({ createAuction: mocks.createAuction }))
vi.mock('../services/properties', () => ({ getMyListings: mocks.getMyListings }))
vi.mock('../services/api', () => ({
  getErrorMessage: (_error: unknown, fallback: string) => fallback,
}))

function property(id: string, status: Property['status']): Property {
  return {
    id,
    title: `Property ${id}`,
    description: 'Approved property details.',
    location: 'Green Park',
    city: 'Bengaluru',
    state: 'Karnataka',
    propertyType: 'HOUSE',
    listingType: 'SALE',
    totalSqft: 1000,
    bhk: 2,
    bathrooms: 2,
    price: 100_000,
    rentPerMonth: null,
    predictedPriceLakhs: null,
    images: [],
    status,
    sellerId: 'seller-1',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
}

describe('SellerAuctionPage', () => {
  beforeEach(() => {
    mocks.getMyListings.mockResolvedValue({
      count: 2,
      properties: [property('approved-1', 'APPROVED'), property('pending-1', 'PENDING')],
    })
    mocks.createAuction.mockResolvedValue({ id: 'auction-1' })
  })

  afterEach(() => cleanup())

  it('offers only approved seller properties and creates an auction through the API', async () => {
    render(
      <MemoryRouter initialEntries={['/seller/auctions/new']}>
        <Routes>
          <Route path="/seller/auctions/new" element={<SellerAuctionPage />} />
          <Route path="/auctions/:id" element={<div>Auction created</div>} />
        </Routes>
      </MemoryRouter>,
    )

    const propertySelect = await screen.findByLabelText('Approved property') as HTMLSelectElement
    expect(Array.from(propertySelect.options).map((option) => option.textContent)).toEqual([
      'Select a property',
      'Property approved-1 — Bengaluru',
    ])
    const startTime = new Date((screen.getByLabelText('Start time') as HTMLInputElement).value)
    const endTime = new Date((screen.getByLabelText('End time') as HTMLInputElement).value)
    expect(endTime.getTime()).toBeGreaterThan(startTime.getTime())
    fireEvent.change(propertySelect, { target: { value: 'approved-1' } })
    fireEvent.change(screen.getByLabelText('Starting price (INR)'), { target: { value: '100000' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create auction' }))

    await waitFor(() => expect(mocks.createAuction).toHaveBeenCalledWith(expect.objectContaining({
      propertyId: 'approved-1',
      startPrice: 100_000,
    })))
    expect(await screen.findByText('Auction created')).toBeTruthy()
  })
})
