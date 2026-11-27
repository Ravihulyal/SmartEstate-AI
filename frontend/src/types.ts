export type UserRole = 'BUYER' | 'SELLER' | 'ADMIN'
export type ListingType = 'SALE' | 'RENT'
export type PropertyStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'SOLD' | 'RENTED'
export type PropertyType = 'APARTMENT' | 'VILLA' | 'HOUSE' | 'PLOT' | 'COMMERCIAL'
export type AuctionStatus = 'UPCOMING' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED'
export type AuctionOutcomeStatus = 'NO_BIDS' | 'PENDING_SELLER_APPROVAL' | 'ACCEPTED' | 'REJECTED'
export type PaymentStatus = 'PENDING' | 'SUCCESS' | 'FAILED' | 'EXPIRED'
export type SaleClosingStatus = 'PENDING' | 'COMPLETED' | 'CANCELLED'

export interface User {
  id: string
  name: string
  email: string
  role: UserRole
  createdAt?: string
}

export interface Property {
  id: string
  title: string
  description: string
  location: string
  city: string
  state: string
  propertyType: PropertyType
  listingType: ListingType
  totalSqft: number
  bhk: number
  bathrooms: number
  price: number | null
  rentPerMonth: number | null
  predictedPriceLakhs: number | null
  images: string[]
  status: PropertyStatus
  sellerId: string
  createdAt: string
  updatedAt: string
  seller?: Pick<User, 'id' | 'name' | 'email'>
}

export interface PropertyPayload {
  title: string
  description: string
  location: string
  city: string
  state: string
  propertyType: PropertyType
  listingType: ListingType
  totalSqft: number
  bhk: number
  bathrooms: number
  price?: number
  rentPerMonth?: number
  images: string[]
}

export interface PropertyFilters {
  city?: string
  listingType?: ListingType | ''
  propertyType?: PropertyType | ''
  bhk?: number | ''
}

export interface PropertyListResponse {
  count: number
  properties: Property[]
}

export interface AuctionProperty {
  id: string
  title: string
  city: string
  state: string
  location: string
  propertyType: PropertyType
  listingType: ListingType
  price: number | null
  rentPerMonth: number | null
  images: string[]
  seller?: Pick<User, 'id' | 'name'>
}

export interface AuctionBid {
  id: string
  amount: number
  createdAt: string
}

export interface Auction {
  id: string
  propertyId: string
  startPrice: number
  currentBid: number | null
  startTime: string
  endTime: string
  status: AuctionStatus
  outcomeStatus?: AuctionOutcomeStatus | null
  winningBid?: { amount: number; bidderName?: string; bidder?: Pick<User, 'name'> } | null
  sellerDecisionAt?: string | null
  sellerDecisionReason?: string | null
  isWinningBidder?: boolean
  createdAt: string
  property: AuctionProperty
  bids?: AuctionBid[]
}

export interface AuctionListResponse {
  count: number
  auctions: Auction[]
}

export type AuctionAdminAction = 'CANCELLED' | 'ENDED_EARLY'
  | 'WINNER_APPROVED' | 'WINNER_REJECTED'

export interface AuctionAuditEntry {
  id: string
  auctionId: string
  adminId: string | null
  sellerId?: string | null
  action: AuctionAdminAction
  reason: string | null
  createdAt: string
  admin?: Pick<User, 'name'> | null
  seller?: Pick<User, 'name'> | null
}

export interface AuctionAuditResponse {
  count: number
  audit: AuctionAuditEntry[]
}

export interface AuctionPayload {
  propertyId: string
  startPrice: number
  startTime: string
  endTime: string
}

export interface PendingSellerApproval {
  id: string
  startTime: string
  endTime: string
  outcomeStatus: 'PENDING_SELLER_APPROVAL'
  winningBid: { amount: number; bidderName: string }
  bids: AuctionBid[]
  property: { id: string; title: string; images: string[] }
}

export interface SimulatedPaymentReceipt {
  receiptReference: string
  transactionReference: string
  amount: string
  currency: 'INR'
  paidAt: string | null
  paymentMode: 'SIMULATED'
  isRealPayment: false
}

export interface BuyerPayment {
  id: string
  auctionId: string
  propertyId: string
  status: PaymentStatus
  amount: string
  currency: 'INR'
  transactionReference: string
  provider: 'SIMULATED'
  paymentMode: 'SIMULATED'
  isRealPayment: false
  createdAt: string
  updatedAt: string
  paidAt: string | null
  expiresAt: string | null
  failureReason: string | null
  auction: {
    status: AuctionStatus
    outcomeStatus: AuctionOutcomeStatus | null
  }
  property: {
    id: string
    title: string
    city: string
    state: string
    images: string[]
  }
  saleClosing: {
    id: string
    status: SaleClosingStatus
    createdAt: string
    completedAt: string | null
  } | null
  simulatedReceipt?: SimulatedPaymentReceipt | null
}

export type SellerPayment = Omit<BuyerPayment, 'simulatedReceipt'>

export interface AdminPayment {
  id: string
  auctionId: string
  propertyId: string
  status: PaymentStatus
  amount: string
  currency: 'INR'
  transactionReference: string
  provider: 'SIMULATED'
  paymentMode: 'SIMULATED'
  isRealPayment: false
  createdAt: string
  paidAt: string | null
  expiresAt: string | null
  saleClosingStatus: SaleClosingStatus | null
  property: { title: string; city: string; state: string }
  auctionOutcomeStatus: AuctionOutcomeStatus | null
}

export interface SaleClosing {
  id: string
  auctionId: string
  propertyId: string
  paymentId: string
  status: SaleClosingStatus
  createdAt: string
  completedAt: string | null
  paymentMode: 'SIMULATED'
  isRealPayment: false
  transactionReference: string
  paymentStatus: PaymentStatus
  amount: string
  currency: 'INR'
  property: {
    id: string
    title: string
    city: string
    state: string
    images: string[]
    status: PropertyStatus
  }
  auction: {
    status: AuctionStatus
    outcomeStatus: AuctionOutcomeStatus | null
  }
}

export interface PaymentAuditEntry {
  id: string
  auctionId: string
  paymentId: string | null
  saleClosingId: string | null
  adminId: string | null
  sellerId: string | null
  buyerId: string | null
  action: string
  reason: string | null
  createdAt: string
}

export interface PageInfo {
  page: number
  limit: number
  hasMore: boolean
}
