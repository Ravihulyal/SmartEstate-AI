// Runtime validation coverage for buyer favorites persistence and dashboard states.
// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Property, PropertyListResponse } from '../types'
import { BuyerDashboard } from './BuyerDashboard'

const mocks = vi.hoisted(() => ({
  addFavorite: vi.fn(),
  getFavorites: vi.fn(),
  getProperties: vi.fn(),
  notify: vi.fn(),
  removeFavorite: vi.fn(),
}))

vi.mock('../services/favorites', () => ({
  addFavorite: mocks.addFavorite,
  getFavorites: mocks.getFavorites,
  removeFavorite: mocks.removeFavorite,
}))
vi.mock('../services/properties', () => ({ getProperties: mocks.getProperties }))
vi.mock('../services/api', () => ({
  getErrorMessage: (_error: unknown, fallback: string) => fallback,
}))
vi.mock('../services/toast', () => ({ notify: mocks.notify }))
vi.mock('../components/BuyerPaymentsPanel', () => ({ BuyerPaymentsPanel: () => null }))

function property(id: string, title: string): Property {
  return {
    id,
    title,
    description: 'A comfortable property near amenities.',
    location: 'Green Park',
    city: 'Bengaluru',
    state: 'Karnataka',
    propertyType: 'APARTMENT',
    listingType: 'SALE',
    totalSqft: 1200,
    bhk: 2,
    bathrooms: 2,
    price: 12000000,
    rentPerMonth: null,
    predictedPriceLakhs: null,
    images: [],
    status: 'APPROVED',
    sellerId: 'seller-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

function renderDashboard() {
  return render(<MemoryRouter><BuyerDashboard /></MemoryRouter>)
}

describe('BuyerDashboard favorites', () => {
  beforeEach(() => {
    mocks.getProperties.mockResolvedValue({ count: 1, properties: [property('available-1', 'Available home')] })
    mocks.getFavorites.mockResolvedValue({ count: 0, properties: [] } satisfies PropertyListResponse)
    mocks.addFavorite.mockResolvedValue(property('available-1', 'Available home'))
    mocks.removeFavorite.mockResolvedValue(undefined)
    mocks.notify.mockReset()
  })

  afterEach(() => cleanup())

  it('loads saved properties from the backend independently of discovery filters', async () => {
    mocks.getFavorites.mockResolvedValue({ count: 1, properties: [property('saved-1', 'Saved home')] })
    renderDashboard()

    fireEvent.click(await screen.findByRole('button', { name: 'Saved homes (1)' }))
    expect(await screen.findByRole('link', { name: 'Saved home' })).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Available home' })).toBeNull()
  })

  it('adds and removes favorites through the API and updates the saved homes view', async () => {
    renderDashboard()
    fireEvent.click(await screen.findByRole('button', { name: 'Add to favorites' }))

    await waitFor(() => expect(mocks.addFavorite).toHaveBeenCalledWith('available-1'))
    fireEvent.click(screen.getByRole('button', { name: 'Saved homes (1)' }))
    expect(await screen.findByRole('link', { name: 'Available home' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Remove from favorites' }))
    await waitFor(() => expect(mocks.removeFavorite).toHaveBeenCalledWith('available-1'))
    expect(await screen.findByText('No saved homes yet')).toBeTruthy()
  })

  it('shows a loading state and supports retry when favorites fail to load', async () => {
    let rejectFavorites: ((error: Error) => void) | undefined
    mocks.getFavorites.mockReturnValueOnce(new Promise((_resolve, reject) => { rejectFavorites = reject }))
    mocks.getFavorites.mockResolvedValueOnce({ count: 0, properties: [] })
    renderDashboard()

    expect(screen.getByRole('button', { name: 'Saved homes (…)' }).hasAttribute('disabled')).toBe(true)
    expect((await screen.findByRole('button', { name: 'Add to favorites' })).hasAttribute('disabled')).toBe(true)
    await act(async () => rejectFavorites?.(new Error('Unavailable')))
    fireEvent.click(await screen.findByRole('button', { name: 'Saved homes (0)' }))
    expect(await screen.findByText('Your saved homes could not be loaded.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('No saved homes yet')).toBeTruthy()
    expect(mocks.getFavorites).toHaveBeenCalledTimes(2)
  })
})
