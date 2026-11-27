// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BuyerPaymentsPanel } from './BuyerPaymentsPanel'
import type { BuyerPayment } from '../types'

const mocks = vi.hoisted(() => ({
  getBuyerPayment: vi.fn(),
  getBuyerPaymentHistory: vi.fn(),
  getBuyerPendingPayments: vi.fn(),
  notify: vi.fn(),
  retryBuyerPayment: vi.fn(),
  simulateBuyerPayment: vi.fn(),
}))

vi.mock('../services/payments', () => ({
  getBuyerPayment: mocks.getBuyerPayment,
  getBuyerPaymentHistory: mocks.getBuyerPaymentHistory,
  getBuyerPendingPayments: mocks.getBuyerPendingPayments,
  retryBuyerPayment: mocks.retryBuyerPayment,
  simulateBuyerPayment: mocks.simulateBuyerPayment,
}))
vi.mock('../hooks/usePaymentNotifications', () => ({ usePaymentNotifications: () => undefined }))
vi.mock('../services/api', () => ({ getErrorMessage: (_error: unknown, fallback: string) => fallback }))
vi.mock('../services/toast', () => ({ notify: mocks.notify }))

function payment(status: BuyerPayment['status'] = 'PENDING', transactionReference = 'SIM-PAY-old'): BuyerPayment {
  const paidAt = status === 'SUCCESS' ? '2026-03-01T12:00:00.000Z' : null
  return {
    id: 'payment-1',
    auctionId: 'auction-1',
    propertyId: 'property-1',
    status,
    amount: '1250000.00',
    currency: 'INR',
    transactionReference,
    provider: 'SIMULATED',
    paymentMode: 'SIMULATED',
    isRealPayment: false,
    createdAt: '2026-03-01T10:00:00.000Z',
    updatedAt: '2026-03-01T10:00:00.000Z',
    paidAt,
    expiresAt: '2099-03-01T12:00:00.000Z',
    failureReason: status === 'FAILED' ? 'Demo failure selected' : null,
    auction: { status: 'COMPLETED', outcomeStatus: 'ACCEPTED' },
    property: { id: 'property-1', title: 'Lakeview Apartment', city: 'Bengaluru', state: 'Karnataka', images: [] },
    saleClosing: status === 'SUCCESS' ? { id: 'closing-1', status: 'PENDING', createdAt: '2026-03-01T12:00:00.000Z', completedAt: null } : null,
    simulatedReceipt: status === 'SUCCESS' ? {
      receiptReference: 'SIM-RECEIPT-SIM-PAY-success',
      transactionReference,
      amount: '1250000.00',
      currency: 'INR',
      paidAt,
      paymentMode: 'SIMULATED',
      isRealPayment: false,
    } : null,
  }
}

describe('BuyerPaymentsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getBuyerPendingPayments.mockResolvedValue({ count: 1, payments: [payment()] })
    mocks.getBuyerPaymentHistory.mockResolvedValue({ payments: [payment()], pagination: { page: 1, limit: 10, hasMore: false } })
    mocks.getBuyerPayment.mockImplementation(async () => ({ payment: payment() }))
    mocks.simulateBuyerPayment.mockResolvedValue({ message: 'Simulated payment succeeded', payment: payment('SUCCESS', 'SIM-PAY-success') })
    mocks.retryBuyerPayment.mockResolvedValue({ message: 'Retry initiated', payment: payment('PENDING', 'SIM-PAY-new') })
  })

  afterEach(() => cleanup())

  it('displays the real server receipt only after a successful simulated outcome', async () => {
    render(<MemoryRouter><BuyerPaymentsPanel /></MemoryRouter>)
    expect(await screen.findByText('Lakeview Apartment')).toBeTruthy()
    expect(screen.getByText('Simulated demo')).toBeTruthy()
    expect(screen.getByText(/No money is moved/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Payment details' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Simulate successful payment' }))

    await waitFor(() => expect(mocks.simulateBuyerPayment).toHaveBeenCalledWith('payment-1', 'SUCCESS'))
    expect(await screen.findByText('Simulated receipt')).toBeTruthy()
    expect(screen.getByText('Payment succeeded; the seller must still confirm the demo sale closing.')).toBeTruthy()
    expect(screen.queryByLabelText(/card|CVV|UPI PIN/i)).toBeNull()
  })

  it('retries a failed request and keeps the previous server reference visible in the current view', async () => {
    mocks.getBuyerPendingPayments.mockResolvedValue({ count: 0, payments: [] })
    mocks.getBuyerPaymentHistory.mockResolvedValue({ payments: [payment('FAILED')], pagination: { page: 1, limit: 10, hasMore: false } })
    mocks.getBuyerPayment.mockResolvedValue({ payment: payment('FAILED') })
    render(<MemoryRouter><BuyerPaymentsPanel /></MemoryRouter>)

    fireEvent.click(await screen.findByRole('tab', { name: 'Payment history' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Payment details' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Start a new simulated attempt' }))

    await waitFor(() => expect(mocks.retryBuyerPayment).toHaveBeenCalledWith('payment-1'))
    expect(await screen.findByText('SIM-PAY-new')).toBeTruthy()
    expect(screen.getByText('SIM-PAY-old')).toBeTruthy()
  })

  it('refreshes and reports backend errors without presenting a fake success state', async () => {
    mocks.getBuyerPendingPayments.mockRejectedValue(new Error('offline'))
    render(<MemoryRouter><BuyerPaymentsPanel /></MemoryRouter>)

    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.queryByText('Simulated receipt')).toBeNull()
    expect(mocks.simulateBuyerPayment).not.toHaveBeenCalled()
  })
})
