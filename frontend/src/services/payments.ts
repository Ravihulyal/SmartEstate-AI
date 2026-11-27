import { api } from './api'
import { createAuthenticatedSocket } from './socket'
import type {
  AdminPayment,
  BuyerPayment,
  PageInfo,
  PaymentAuditEntry,
  PaymentStatus,
  SaleClosing,
  SaleClosingStatus,
  SellerPayment,
} from '../types'

export interface PaymentPage<T> {
  payments: T[]
  pagination: PageInfo
}

export interface ClosingPage {
  closings: SaleClosing[]
  pagination: PageInfo
}

export interface AuditPage {
  audit: PaymentAuditEntry[]
  pagination: PageInfo
}

export interface PaymentPageQuery {
  page?: number
  limit?: number
  status?: PaymentStatus
}

export interface ClosingPageQuery {
  page?: number
  limit?: number
  status?: SaleClosingStatus
}

export interface AuditPageQuery {
  page?: number
  limit?: number
  auctionId?: string
  paymentId?: string
  saleClosingId?: string
}

export async function getBuyerPendingPayments(): Promise<{ count: number; payments: BuyerPayment[] }> {
  const response = await api.get<{ count: number; payments: BuyerPayment[] }>('/payments/mine/pending')
  return response.data
}

export async function getBuyerPaymentHistory(query: PaymentPageQuery = {}): Promise<PaymentPage<BuyerPayment>> {
  const response = await api.get<PaymentPage<BuyerPayment>>('/payments/mine/history', { params: query })
  return response.data
}

export async function getBuyerPayment(id: string): Promise<{ payment: BuyerPayment }> {
  const response = await api.get<{ payment: BuyerPayment }>(`/payments/${encodeURIComponent(id)}`)
  return response.data
}

export async function simulateBuyerPayment(
  id: string,
  outcome: 'SUCCESS' | 'FAILED',
): Promise<{ message: string; payment: BuyerPayment }> {
  const response = await api.post<{ message: string; payment: BuyerPayment }>(
    `/payments/${encodeURIComponent(id)}/simulate`,
    { outcome },
  )
  return response.data
}

export async function retryBuyerPayment(id: string): Promise<{ message: string; payment: BuyerPayment }> {
  const response = await api.post<{ message: string; payment: BuyerPayment }>(
    `/payments/${encodeURIComponent(id)}/retry`,
  )
  return response.data
}

export async function getSellerPayments(query: PaymentPageQuery = {}): Promise<PaymentPage<SellerPayment>> {
  const response = await api.get<PaymentPage<SellerPayment>>('/payments/seller/payments', { params: query })
  return response.data
}

export async function getSellerClosings(query: ClosingPageQuery = {}): Promise<ClosingPage> {
  const response = await api.get<ClosingPage>('/payments/seller/closings', { params: query })
  return response.data
}

export async function confirmSellerClosing(id: string): Promise<{ message: string; closing: SaleClosing }> {
  const response = await api.post<{ message: string; closing: SaleClosing }>(
    `/payments/seller/closings/${encodeURIComponent(id)}/confirm`,
  )
  return response.data
}

export async function getAdminPayments(query: PaymentPageQuery = {}): Promise<PaymentPage<AdminPayment>> {
  const response = await api.get<PaymentPage<AdminPayment>>('/payments/admin/all', { params: query })
  return response.data
}

export async function getAdminClosings(query: ClosingPageQuery = {}): Promise<ClosingPage> {
  const response = await api.get<ClosingPage>('/payments/admin/closings', { params: query })
  return response.data
}

export async function getAdminPaymentAudit(query: AuditPageQuery = {}): Promise<AuditPage> {
  const response = await api.get<AuditPage>('/payments/admin/audit', { params: query })
  return response.data
}

export type PaymentSocketEvent =
  | 'payment:request-created'
  | 'payment:initiated'
  | 'payment:succeeded'
  | 'payment:failed'
  | 'payment:expired'
  | 'sale-closing:pending'
  | 'sale-closing:completed'
  | 'admin:payment-updated'

export interface PaymentSocketPayload {
  paymentId?: string
  auctionId?: string
  status?: string
  paymentMode?: 'SIMULATED'
  isRealPayment?: false
}

const paymentEvents: PaymentSocketEvent[] = [
  'payment:request-created',
  'payment:initiated',
  'payment:succeeded',
  'payment:failed',
  'payment:expired',
  'sale-closing:pending',
  'sale-closing:completed',
  'admin:payment-updated',
]

export function subscribeToPaymentEvents(
  onEvent: (event: PaymentSocketEvent, payload: PaymentSocketPayload) => void,
  onConnectionError?: () => void,
): () => void {
  const socket = createAuthenticatedSocket()
  if (!socket) return () => undefined

  for (const event of paymentEvents) {
    socket.on(event, (payload: PaymentSocketPayload) => onEvent(event, payload ?? {}))
  }
  socket.on('connect_error', () => onConnectionError?.())

  return () => socket.disconnect()
}
