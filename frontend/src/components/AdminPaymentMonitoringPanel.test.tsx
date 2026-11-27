// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AdminPaymentMonitoringPanel } from './AdminPaymentMonitoringPanel'
import type { Auction, PaymentAuditEntry, SaleClosing } from '../types'

const mocks = vi.hoisted(() => ({
  getAdminAuctions: vi.fn(),
  getAdminClosings: vi.fn(),
  getAdminPaymentAudit: vi.fn(),
  getAdminPayments: vi.fn(),
}))

vi.mock('../services/auctions', () => ({ getAdminAuctions: mocks.getAdminAuctions }))
vi.mock('../services/payments', () => ({
  getAdminClosings: mocks.getAdminClosings,
  getAdminPaymentAudit: mocks.getAdminPaymentAudit,
  getAdminPayments: mocks.getAdminPayments,
}))
vi.mock('../hooks/usePaymentNotifications', () => ({ usePaymentNotifications: () => undefined }))
vi.mock('../services/api', () => ({ getErrorMessage: (_error: unknown, fallback: string) => fallback }))

const pagination = { page: 1, limit: 10, hasMore: false }

function auction(): Auction {
  return {
    id: 'auction-1',
    propertyId: 'property-1',
    startPrice: 1_000_000,
    currentBid: 1_250_000,
    startTime: '2026-02-01T10:00:00.000Z',
    endTime: '2026-03-01T10:00:00.000Z',
    status: 'COMPLETED',
    outcomeStatus: 'PENDING_SELLER_APPROVAL',
    winningBid: { amount: 1_250_000 },
    createdAt: '2026-02-01T10:00:00.000Z',
    property: {
      id: 'property-1',
      title: 'Lakeview Apartment',
      city: 'Bengaluru',
      state: 'Karnataka',
      location: 'Green Park',
      propertyType: 'APARTMENT',
      listingType: 'SALE',
      price: 1_300_000,
      rentPerMonth: null,
      images: [],
    },
  }
}

function closing(): SaleClosing {
  return {
    id: 'closing-1',
    auctionId: 'auction-1',
    propertyId: 'property-1',
    paymentId: 'payment-1',
    status: 'PENDING',
    createdAt: '2026-03-01T10:00:00.000Z',
    completedAt: null,
    paymentMode: 'SIMULATED',
    isRealPayment: false,
    transactionReference: 'SIM-PAY-1',
    paymentStatus: 'SUCCESS',
    amount: '1250000.00',
    currency: 'INR',
    property: { id: 'property-1', title: 'Lakeview Apartment', city: 'Bengaluru', state: 'Karnataka', images: [], status: 'APPROVED' },
    auction: { status: 'COMPLETED', outcomeStatus: 'ACCEPTED' },
  }
}

function auditEntry(): PaymentAuditEntry {
  return {
    id: 'audit-1',
    auctionId: 'auction-1',
    paymentId: 'payment-1',
    saleClosingId: 'closing-1',
    adminId: null,
    sellerId: 'seller-1',
    buyerId: null,
    action: 'SALE_CLOSING_CREATED',
    reason: 'Simulated payment succeeded',
    createdAt: '2026-03-01T10:00:00.000Z',
  }
}

describe('AdminPaymentMonitoringPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getAdminAuctions.mockResolvedValue({ count: 1, auctions: [auction()] })
    mocks.getAdminPayments.mockResolvedValue({ payments: [], pagination })
    mocks.getAdminClosings.mockResolvedValue({ closings: [closing()], pagination })
    mocks.getAdminPaymentAudit.mockResolvedValue({ audit: [auditEntry()], pagination })
  })

  afterEach(() => cleanup())

  it('shows pending seller decisions while keeping the admin transaction panel read-only', async () => {
    render(<AdminPaymentMonitoringPanel />)

    expect(await screen.findByText('Awaiting seller decisions (1)')).toBeTruthy()
    expect(screen.getByText('Lakeview Apartment')).toBeTruthy()
    expect(screen.getByText(/Admins cannot approve payments or complete seller closings/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /approve|confirm demo closing|simulate/i })).toBeNull()
  })

  it('shows audit rows and applies provided audit identifiers', async () => {
    render(<AdminPaymentMonitoringPanel />)
    fireEvent.click(await screen.findByRole('tab', { name: 'Audit history' }))
    expect(await screen.findByText('sale closing created')).toBeTruthy()

    fireEvent.change(screen.getByLabelText('Payment ID'), { target: { value: 'payment-1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply audit filters' }))
    await waitFor(() => expect(mocks.getAdminPaymentAudit).toHaveBeenLastCalledWith({
      paymentId: 'payment-1',
      page: 1,
      limit: 10,
    }))
  })
})
