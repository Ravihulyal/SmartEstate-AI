import { api } from './api'
import { createAuthenticatedSocket } from './socket'
import type {
  Auction,
  AuctionAuditResponse,
  AuctionBid,
  AuctionListResponse,
  AuctionPayload,
  AuctionStatus,
  PendingSellerApproval,
} from '../types'

export async function getAuctions(): Promise<AuctionListResponse> {
  const response = await api.get<AuctionListResponse>('/auctions')
  return response.data
}

export async function getAuction(id: string): Promise<Auction> {
  const response = await api.get<{ auction: Auction }>(`/auctions/${encodeURIComponent(id)}`)
  return response.data.auction
}

export async function getAuctionBids(id: string): Promise<{ count: number; bids: AuctionBid[] }> {
  const response = await api.get<{ count: number; bids: AuctionBid[] }>(`/auctions/${encodeURIComponent(id)}/bids`)
  return response.data
}

export async function createAuction(payload: AuctionPayload): Promise<Auction> {
  const response = await api.post<{ auction: Auction }>('/auctions', payload)
  return response.data.auction
}

export async function getMyAuctions(): Promise<AuctionListResponse> {
  const response = await api.get<AuctionListResponse>('/auctions/seller/mine')
  return response.data
}

export async function getPendingSellerApprovals(): Promise<{
  count: number
  auctions: PendingSellerApproval[]
}> {
  const response = await api.get<{
    count: number
    auctions: PendingSellerApproval[]
  }>('/auctions/seller/pending-approval')
  return response.data
}

export async function approveAuctionWinner(id: string, reason?: string): Promise<Auction> {
  const response = await api.post<{ auction: Auction }>(
    `/auctions/${encodeURIComponent(id)}/approve-winner`,
    reason === undefined ? {} : { reason },
  )
  return response.data.auction
}

export async function rejectAuctionWinner(id: string, reason: string): Promise<Auction> {
  const response = await api.post<{ auction: Auction }>(
    `/auctions/${encodeURIComponent(id)}/reject-winner`,
    { reason },
  )
  return response.data.auction
}

export async function getAdminAuctions(): Promise<AuctionListResponse> {
  const response = await api.get<AuctionListResponse>('/auctions/admin/all')
  return response.data
}

export async function updateAuctionSchedule(
  id: string,
  schedule: { startTime: string; endTime: string },
): Promise<Auction> {
  const response = await api.patch<{ auction: Auction }>(
    `/auctions/${encodeURIComponent(id)}/schedule`,
    schedule,
  )
  return response.data.auction
}

export async function cancelAuction(id: string, reason?: string): Promise<Auction> {
  const response = await api.post<{ auction: Auction }>(
    `/auctions/${encodeURIComponent(id)}/cancel`,
    reason === undefined ? {} : { reason },
  )
  return response.data.auction
}

export async function endAuctionEarly(id: string, reason: string): Promise<Auction> {
  const response = await api.post<{ auction: Auction }>(
    `/auctions/${encodeURIComponent(id)}/end-early`,
    { reason },
  )
  return response.data.auction
}

export async function getAuctionAudit(id: string): Promise<AuctionAuditResponse> {
  const response = await api.get<AuctionAuditResponse>(
    `/auctions/${encodeURIComponent(id)}/audit`,
  )
  return response.data
}

export async function placeAuctionBid(id: string, amount: number): Promise<{ bid: AuctionBid; currentBid: number }> {
  const response = await api.post<{ bid: AuctionBid; currentBid: number }>(
    `/auctions/${encodeURIComponent(id)}/bids`,
    { amount },
  )
  return response.data
}

export interface AuctionSocketHandlers {
  onBid: (payload: { auctionId: string; amount: number; createdAt: string; currentBid: number }) => void
  onStatus: (payload: AuctionSocketStatus) => void
  onScheduleUpdated?: (payload: AuctionSocketStatus) => void
  onCancelled?: (payload: AuctionSocketStatus) => void
  onEndedEarly?: (payload: AuctionSocketStatus) => void
  onAwaitingSellerApproval?: (payload: AuctionSocketOutcome) => void
  onNoBids?: (payload: AuctionSocketOutcome) => void
  onWinnerApproved?: (payload: AuctionSocketOutcome) => void
  onWinnerRejected?: (payload: AuctionSocketOutcome) => void
  onWinnerConfirmed?: (payload: AuctionSocketOutcome) => void
  onError: (message: string) => void
  onConnection: (connected: boolean) => void
}

export interface AuctionSocketStatus {
  auctionId: string
  status: AuctionStatus
  startTime: string
  endTime: string
  currentBid: number | null
}

export interface AuctionSocketOutcome {
  auctionId: string
  status: 'COMPLETED'
  outcomeStatus: NonNullable<Auction['outcomeStatus']>
  winningBidAmount: number | null
  endTime: string
}

export function subscribeToAuction(auctionId: string, handlers: AuctionSocketHandlers): () => void {
  const socket = createAuthenticatedSocket()
  if (!socket) {
    handlers.onConnection(false)
    return () => undefined
  }

  socket.on('connect', () => {
    handlers.onConnection(true)
    socket.emit('auction:join', { auctionId })
  })
  socket.on('disconnect', () => handlers.onConnection(false))
  socket.on('connect_error', () => {
    handlers.onConnection(false)
    handlers.onError('Live updates are unavailable. You can still refresh the auction manually.')
  })
  socket.on('auction:bid-updated', handlers.onBid)
  socket.on('auction:status', handlers.onStatus)
  if (handlers.onScheduleUpdated) socket.on('auction:schedule-updated', handlers.onScheduleUpdated)
  if (handlers.onCancelled) socket.on('auction:cancelled', handlers.onCancelled)
  if (handlers.onEndedEarly) socket.on('auction:ended-early', handlers.onEndedEarly)
  if (handlers.onAwaitingSellerApproval) socket.on('auction:awaiting-seller-approval', handlers.onAwaitingSellerApproval)
  if (handlers.onNoBids) socket.on('auction:no-bids', handlers.onNoBids)
  if (handlers.onWinnerApproved) socket.on('auction:winner-approved', handlers.onWinnerApproved)
  if (handlers.onWinnerRejected) socket.on('auction:winner-rejected', handlers.onWinnerRejected)
  if (handlers.onWinnerConfirmed) socket.on('auction:winner-confirmed', handlers.onWinnerConfirmed)
  socket.on('auction:error', (payload: { message?: unknown }) => {
    handlers.onError(typeof payload?.message === 'string' ? payload.message : 'Unable to join live auction updates.')
  })

  return () => {
    if (socket.connected) socket.emit('auction:leave', { auctionId })
    socket.disconnect()
  }
}

