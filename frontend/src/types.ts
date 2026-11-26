export type UserRole = 'BUYER' | 'SELLER' | 'ADMIN'
export type ListingType = 'SALE' | 'RENT'
export type PropertyStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'SOLD' | 'RENTED'
export type PropertyType = 'APARTMENT' | 'VILLA' | 'HOUSE' | 'PLOT' | 'COMMERCIAL'

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
