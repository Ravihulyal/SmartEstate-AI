// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SellerClosingPanel } from './SellerClosingPanel'
import type { SaleClosing } from '../types'

const mocks = vi.hoisted(() => ({
  confirmSellerClosing: vi.fn(),
  getSellerClosings: vi.fn(),
  getSellerPayments: vi.fn(),
  notify: vi.fn(),
}))

vi.mock('../services/payments', () => ({
  confirmSellerClosing: mocks.confirmSellerClosing,
  getSellerClosings: mocks.getSellerClosings,
  getSellerPayments: mocks.getSellerPayments,
}))
vi.mock('../hooks/usePaymentNotifications', () => ({ usePaymentNotifications: () => undefined }))
vi.mock('../services/api', () => ({ getErrorMessage: (_error: unknown, fallback: string) => fallback }))
vi.mock('../services/toast', () => ({ notify: mocks.notify }))

function closing(paymentStatus: SaleClosing['paymentStatus'] = 'SUCCESS'): SaleClosing {
  return {
    id: 'closing-1',
    auctionId: 'auction-1',
    propertyId: 'property-1',
    paymentId: 'payment-1',
    status: 'PENDING',
    createdAt: '2026-03-01T12:00:00.000Z',
    completedAt: null,
    paymentMode: 'SIMULATED',
    isRealPayment: false,
    transactionReference: 'SIM-PAY-1',
    paymentStatus,
    amount: '1250000.00',
    currency: 'INR',
    property: {
      id: 'property-1',
      title: 'Lakeview Apartment',
      city: 'Bengaluru',
      state: 'Karnataka',
      images: [],
      status: 'APPROVED',
    },
    auction: { status: 'COMPLETED', outcomeStatus: 'ACCEPTED' },
  }
}

describe('SellerClosingPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getSellerPayments.mockResolvedValue({ payments: [], pagination: { page: 1, limit: 10, hasMore: false } })
    mocks.getSellerClosings.mockImplementation(async ({ status }: { status?: string }) => ({
      closings: status === 'PENDING' ? [closing()] : [],
      pagination: { page: 1, limit: 10, hasMore: false },
    }))
    mocks.confirmSellerClosing.mockResolvedValue({ message: 'Completed', closing: { ...closing(), status: 'COMPLETED' } })
  })

  afterEach(() => cleanup())

  it('requires explicit seller confirmation and refreshes the closing after completion', async () => {
    const onClosingCompleted = vi.fn()
    render(<SellerClosingPanel onClosingCompleted={onClosingCompleted} />)

    expect(await screen.findByText('Lakeview Apartment')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm demo closing' }))
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(screen.getByText(/does not transfer legal property title/i)).toBeTruthy()
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Confirm demo closing' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm demo closing' }))

    await waitFor(() => expect(mocks.confirmSellerClosing).toHaveBeenCalledWith('closing-1'))
    await waitFor(() => expect(onClosingCompleted).toHaveBeenCalledOnce())
  })

  it('does not offer completion when the simulated payment has not succeeded', async () => {
    mocks.getSellerClosings.mockImplementation(async ({ status }: { status?: string }) => ({
      closings: status === 'PENDING' ? [closing('PENDING')] : [],
      pagination: { page: 1, limit: 10, hasMore: false },
    }))
    render(<SellerClosingPanel />)

    expect(await screen.findByText('Lakeview Apartment')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Confirm demo closing' })).toBeNull()
  })
})
