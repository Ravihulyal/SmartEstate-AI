// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PendingSellerApproval } from '../types'
import { PendingWinnerApprovalPanel } from './PendingWinnerApprovalPanel'

const mocks = vi.hoisted(() => ({
  approveAuctionWinner: vi.fn(),
  getPendingSellerApprovals: vi.fn(),
  rejectAuctionWinner: vi.fn(),
  notify: vi.fn(),
}))

vi.mock('../services/auctions', () => ({
  approveAuctionWinner: mocks.approveAuctionWinner,
  getPendingSellerApprovals: mocks.getPendingSellerApprovals,
  rejectAuctionWinner: mocks.rejectAuctionWinner,
}))
vi.mock('../services/api', () => ({
  getErrorMessage: (_error: unknown, fallback: string) => fallback,
}))
vi.mock('../services/toast', () => ({ notify: mocks.notify }))

const pending: PendingSellerApproval = {
  id: 'auction-1',
  startTime: '2026-11-25T10:00:00.000Z',
  endTime: '2026-11-26T10:00:00.000Z',
  outcomeStatus: 'PENDING_SELLER_APPROVAL',
  winningBid: { amount: 150_000, bidderName: 'Buyer Name' },
  bids: [
    { id: 'bid-1', amount: 150_000, createdAt: '2026-11-26T09:00:00.000Z' },
    { id: 'bid-2', amount: 125_000, createdAt: '2026-11-26T08:00:00.000Z' },
  ],
  property: { id: 'property-1', title: 'Garden home', images: [] },
}

describe('PendingWinnerApprovalPanel', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    mocks.getPendingSellerApprovals.mockResolvedValue({ count: 1, auctions: [pending] })
    mocks.approveAuctionWinner.mockResolvedValue({})
    mocks.rejectAuctionWinner.mockResolvedValue({})
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('shows the highest bid and asks for confirmation before accepting', async () => {
    mocks.getPendingSellerApprovals
      .mockResolvedValueOnce({ count: 1, auctions: [pending] })
      .mockResolvedValueOnce({ count: 0, auctions: [] })
    render(<MemoryRouter><PendingWinnerApprovalPanel /></MemoryRouter>)

    expect(await screen.findByText('Pending Winner Approval')).toBeTruthy()
    expect(await screen.findByText('Buyer Name')).toBeTruthy()
    expect(screen.getAllByText('₹1,50,000.00')).toHaveLength(2)
    expect(screen.getAllByRole('listitem')).toHaveLength(2)

    fireEvent.click(screen.getByRole('button', { name: 'Accept highest bid' }))
    await waitFor(() => expect(mocks.approveAuctionWinner).toHaveBeenCalledWith('auction-1', undefined))
    expect(window.confirm).toHaveBeenCalledOnce()
    expect(await screen.findByText('No auctions need a decision')).toBeTruthy()
  })

  it('requires a rejection reason and confirms before rejecting', async () => {
    render(<MemoryRouter><PendingWinnerApprovalPanel /></MemoryRouter>)
    const reject = await screen.findByRole('button', { name: 'Reject highest bid' })
    expect(reject.hasAttribute('disabled')).toBe(true)

    fireEvent.change(screen.getByLabelText('Rejection reason (required to reject)'), {
      target: { value: 'No' },
    })
    expect(reject.hasAttribute('disabled')).toBe(true)

    fireEvent.change(screen.getByLabelText('Rejection reason (required to reject)'), {
      target: { value: 'Offer terms declined' },
    })
    fireEvent.click(reject)
    await waitFor(() => expect(mocks.rejectAuctionWinner).toHaveBeenCalledWith(
      'auction-1',
      'Offer terms declined',
    ))
    expect(window.confirm).toHaveBeenCalledOnce()
  })
})
