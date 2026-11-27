// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Auction, AuctionBid } from '../types'
import type { AuctionSocketHandlers } from '../services/auctions'
import { AuctionDetailsPage } from './AuctionDetailsPage'

const mocks = vi.hoisted(() => ({
  getAuction: vi.fn(),
  getAuctionBids: vi.fn(),
  placeAuctionBid: vi.fn(),
  subscribeToAuction: vi.fn(),
  notify: vi.fn(),
  buyer: { id: 'buyer-1', role: 'BUYER' as const },
}))

vi.mock('../services/auctions', () => ({
  getAuction: mocks.getAuction,
  getAuctionBids: mocks.getAuctionBids,
  placeAuctionBid: mocks.placeAuctionBid,
  subscribeToAuction: mocks.subscribeToAuction,
}))
vi.mock('../services/api', () => ({
  getErrorMessage: (_error: unknown, fallback: string) => fallback,
}))
vi.mock('../services/toast', () => ({ notify: mocks.notify }))
vi.mock('../hooks/authContext', () => ({
  useAuth: () => ({ user: mocks.buyer }),
}))

let socketHandlers: AuctionSocketHandlers | null = null

function makeAuction(status: Auction['status'] = 'ACTIVE'): Auction {
  return {
    id: 'auction-1',
    propertyId: 'property-1',
    startPrice: 100_000,
    currentBid: null,
    startTime: new Date(Date.now() - 60_000).toISOString(),
    endTime: new Date(Date.now() + 3_600_000).toISOString(),
    status,
    createdAt: new Date().toISOString(),
    property: {
      id: 'property-1',
      title: 'Garden home',
      city: 'Bengaluru',
      state: 'Karnataka',
      location: 'Green Park',
      propertyType: 'HOUSE',
      listingType: 'SALE',
      price: 100_000,
      rentPerMonth: null,
      images: [],
    },
  }
}

function renderAuction() {
  return render(
    <MemoryRouter initialEntries={['/auctions/auction-1']}>
      <Routes><Route path="/auctions/:id" element={<AuctionDetailsPage />} /></Routes>
    </MemoryRouter>,
  )
}

describe('AuctionDetailsPage', () => {
  beforeEach(() => {
    socketHandlers = null
    localStorage.setItem('smartestate_token', 'buyer-token')
    mocks.getAuction.mockResolvedValue(makeAuction())
    mocks.getAuctionBids.mockResolvedValue({ count: 0, bids: [] })
    mocks.notify.mockReset()
    mocks.placeAuctionBid.mockResolvedValue({
      bid: { id: 'bid-1', amount: 100_000, createdAt: new Date().toISOString() } satisfies AuctionBid,
      currentBid: 100_000,
    })
    mocks.subscribeToAuction.mockImplementation((_id: string, handlers: AuctionSocketHandlers) => {
      socketHandlers = handlers
      return vi.fn()
    })
  })

  afterEach(() => {
    cleanup()
    localStorage.clear()
  })

  it('places a bid and applies server-confirmed live bid updates', async () => {
    renderAuction()
    expect(await screen.findByText('Starting price · no bids yet')).toBeTruthy()
    await waitFor(() => expect(mocks.subscribeToAuction).toHaveBeenCalledWith('auction-1', expect.any(Object)))
    fireEvent.change(screen.getByLabelText('Your bid (INR)'), { target: { value: '100000' } })
    fireEvent.click(screen.getByRole('button', { name: 'Place bid' }))

    await waitFor(() => expect(mocks.placeAuctionBid).toHaveBeenCalledWith('auction-1', 100_000))
    expect(await screen.findByText('Highest bid')).toBeTruthy()

    await act(async () => {
      socketHandlers?.onBid({
        auctionId: 'auction-1',
        amount: 101_000,
        createdAt: new Date().toISOString(),
        currentBid: 101_000,
      })
    })
    expect(await screen.findByText('₹1,01,000.00')).toBeTruthy()
    await waitFor(() => expect(mocks.getAuctionBids).toHaveBeenCalledTimes(3))
  })

  it('does not expose bidding controls before the auction starts', async () => {
    mocks.getAuction.mockResolvedValueOnce(makeAuction('UPCOMING'))
    renderAuction()
    expect(await screen.findByText('Bidding opens at the scheduled start time.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Place bid' })).toBeNull()
  })

  it('does not expose bidding controls after an auction closes', async () => {
    mocks.getAuction.mockResolvedValueOnce(makeAuction('COMPLETED'))
    renderAuction()
    expect(await screen.findByText('This auction is not accepting bids.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Place bid' })).toBeNull()
  })

  it('updates buyer status and shows schedule and cancellation notifications', async () => {
    renderAuction()
    await waitFor(() => expect(mocks.subscribeToAuction).toHaveBeenCalledOnce())

    await act(async () => {
      socketHandlers?.onScheduleUpdated?.({
        auctionId: 'auction-1',
        status: 'UPCOMING',
        startTime: new Date(Date.now() + 3_600_000).toISOString(),
        endTime: new Date(Date.now() + 7_200_000).toISOString(),
        currentBid: null,
      })
      socketHandlers?.onCancelled?.({
        auctionId: 'auction-1',
        status: 'CANCELLED',
        startTime: new Date(Date.now() + 3_600_000).toISOString(),
        endTime: new Date(Date.now() + 7_200_000).toISOString(),
        currentBid: null,
      })
      socketHandlers?.onStatus({
        auctionId: 'auction-1',
        status: 'CANCELLED',
        startTime: new Date(Date.now() + 3_600_000).toISOString(),
        endTime: new Date(Date.now() + 7_200_000).toISOString(),
        currentBid: null,
      })
    })

    expect(mocks.notify).toHaveBeenCalledWith('Auction schedule updated.')
    expect(mocks.notify).toHaveBeenCalledWith('This auction has been cancelled.')
    expect(await screen.findByText('Cancelled')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Place bid' })).toBeNull()
  })

  it('shows a completed auction bid as provisional until seller approval', async () => {
    mocks.getAuction.mockResolvedValueOnce({
      ...makeAuction('COMPLETED'),
      outcomeStatus: 'PENDING_SELLER_APPROVAL',
      winningBid: { amount: 150_000 },
      isWinningBidder: false,
    } satisfies Auction)
    renderAuction()

    expect(await screen.findByText('Provisional highest bid')).toBeTruthy()
    expect(screen.getByText('The highest bid is provisional while awaiting seller approval. No winner has been confirmed.')).toBeTruthy()
    expect(screen.getByText('₹1,50,000.00')).toBeTruthy()
    expect(screen.queryByText(/confirmed winning bidder/)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Place bid' })).toBeNull()
  })

  it('confirms the accepted bidder privately and reports rejected auctions as unsold', async () => {
    mocks.getAuction.mockResolvedValueOnce({
      ...makeAuction('COMPLETED'),
      outcomeStatus: 'ACCEPTED',
      winningBid: { amount: 150_000 },
      isWinningBidder: true,
    } satisfies Auction)
    const { unmount } = renderAuction()
    expect(await screen.findByText('You are the confirmed winning bidder. Payment and property transfer are not included.')).toBeTruthy()
    unmount()

    mocks.getAuction.mockResolvedValueOnce({
      ...makeAuction('COMPLETED'),
      outcomeStatus: 'REJECTED',
      winningBid: { amount: 150_000 },
      isWinningBidder: false,
    } satisfies Auction)
    renderAuction()
    expect(await screen.findByText('The seller rejected the highest bid. The property was not sold through this auction.')).toBeTruthy()
  })
})
