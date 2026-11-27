// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AuctionManagementPanel } from './AuctionManagementPanel'
import type { Auction, AuctionAuditEntry } from '../types'

const mocks = vi.hoisted(() => ({
  cancelAuction: vi.fn(),
  endAuctionEarly: vi.fn(),
  getAdminAuctions: vi.fn(),
  getAuctionAudit: vi.fn(),
  getMyAuctions: vi.fn(),
  updateAuctionSchedule: vi.fn(),
  notify: vi.fn(),
}))

vi.mock('../services/auctions', () => ({
  cancelAuction: mocks.cancelAuction,
  endAuctionEarly: mocks.endAuctionEarly,
  getAdminAuctions: mocks.getAdminAuctions,
  getAuctionAudit: mocks.getAuctionAudit,
  getMyAuctions: mocks.getMyAuctions,
  updateAuctionSchedule: mocks.updateAuctionSchedule,
}))
vi.mock('../services/api', () => ({
  getErrorMessage: (_error: unknown, fallback: string) => fallback,
}))
vi.mock('../services/toast', () => ({ notify: mocks.notify }))

function makeAuction(id: string, status: Auction['status']): Auction {
  const active = status === 'ACTIVE'
  return {
    id,
    propertyId: `property-${id}`,
    startPrice: 100_000,
    currentBid: active ? 125_000 : null,
    startTime: new Date(Date.now() + (active ? -60 : 60) * 60_000).toISOString(),
    endTime: new Date(Date.now() + 3 * 60 * 60_000).toISOString(),
    status,
    createdAt: new Date().toISOString(),
    property: {
      id: `property-${id}`,
      title: `Property ${id}`,
      city: 'Bengaluru',
      state: 'Karnataka',
      location: 'Green Park',
      propertyType: 'HOUSE',
      listingType: 'SALE',
      price: 150_000,
      rentPerMonth: null,
      images: [],
      seller: { id: 'seller-1', name: 'Sita Seller' },
    },
  }
}

function futureLocalTime(hours: number): string {
  const date = new Date(Date.now() + hours * 60 * 60_000)
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
}

describe('AuctionManagementPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const auctions = [makeAuction('upcoming', 'UPCOMING')]
    mocks.getMyAuctions.mockResolvedValue({ count: auctions.length, auctions })
    mocks.getAdminAuctions.mockResolvedValue({
      count: auctions.length,
      auctions: [makeAuction('upcoming', 'UPCOMING'), makeAuction('live', 'ACTIVE')],
    })
    mocks.cancelAuction.mockResolvedValue(makeAuction('upcoming', 'CANCELLED'))
    mocks.endAuctionEarly.mockResolvedValue(makeAuction('live', 'COMPLETED'))
    mocks.updateAuctionSchedule.mockResolvedValue(makeAuction('upcoming', 'UPCOMING'))
    mocks.getAuctionAudit.mockResolvedValue({ count: 0, audit: [] })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('lets sellers edit and cancel only upcoming auctions with cancellation confirmation', async () => {
    const auctions = [
      makeAuction('upcoming', 'UPCOMING'),
      makeAuction('live', 'ACTIVE'),
      makeAuction('ended', 'COMPLETED'),
      makeAuction('cancelled', 'CANCELLED'),
    ]
    mocks.getMyAuctions.mockResolvedValue({ count: auctions.length, auctions })
    render(<AuctionManagementPanel mode="SELLER" />)

    expect(await screen.findByText('Property upcoming')).toBeTruthy()
    expect(screen.getAllByRole('button', { name: 'Edit schedule' })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: 'Cancel auction' })).toHaveLength(1)
    expect(screen.queryByRole('button', { name: 'End early' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Edit schedule' }))
    fireEvent.change(screen.getByLabelText('New start time'), { target: { value: futureLocalTime(4) } })
    fireEvent.change(screen.getByLabelText('New end time'), { target: { value: futureLocalTime(5) } })
    fireEvent.click(screen.getByRole('button', { name: 'Save schedule' }))
    await waitFor(() => expect(mocks.updateAuctionSchedule).toHaveBeenCalledWith(
      'upcoming',
      expect.objectContaining({ startTime: expect.any(String), endTime: expect.any(String) }),
    ))

    fireEvent.click(screen.getByRole('button', { name: 'Cancel auction' }))
    await waitFor(() => expect(mocks.cancelAuction).toHaveBeenCalledWith('upcoming', undefined))
    expect(window.confirm).toHaveBeenCalledOnce()
  })

  it('requires admin reasons, supports live cancellation and early ending, and displays audit history', async () => {
    const auditEntry: AuctionAuditEntry = {
      id: 'audit-1',
      auctionId: 'live',
      adminId: 'admin-1',
      action: 'ENDED_EARLY',
      reason: 'Safety inspection',
      createdAt: new Date().toISOString(),
      admin: { name: 'Asha Admin' },
    }
    mocks.getAuctionAudit.mockResolvedValue({ count: 1, audit: [auditEntry] })
    render(<AuctionManagementPanel mode="ADMIN" />)

    expect(await screen.findByText('Property live')).toBeTruthy()
    expect(screen.getAllByText('Seller: Sita Seller')).toHaveLength(2)
    expect(screen.getAllByRole('button', { name: 'Edit schedule' })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: 'Cancel auction' })).toHaveLength(2)
    expect(screen.getByRole('button', { name: 'End early' }).hasAttribute('disabled')).toBe(true)

    const reasons = screen.getAllByLabelText('Administrative action reason')
    fireEvent.change(reasons[0], { target: { value: 'Cancel due to review' } })
    fireEvent.change(reasons[1], { target: { value: 'Safety inspection' } })
    expect(screen.getByRole('button', { name: 'End early' }).hasAttribute('disabled')).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'End early' }))
    await waitFor(() => expect(mocks.endAuctionEarly).toHaveBeenCalledWith('live', 'Safety inspection'))

    fireEvent.click(screen.getAllByRole('button', { name: 'Cancel auction' })[0])
    await waitFor(() => expect(mocks.cancelAuction).toHaveBeenCalledWith('upcoming', 'Cancel due to review'))

    fireEvent.click(screen.getAllByRole('button', { name: 'Audit history' })[1])
    expect(await screen.findByText('Safety inspection')).toBeTruthy()
    expect(screen.getByText(/Admin: Asha Admin/)).toBeTruthy()
  })
})
