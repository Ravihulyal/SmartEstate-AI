import { api } from './api'
import type { ListingType, Property, PropertyFilters, PropertyListResponse, PropertyPayload, PropertyStatus, PropertyType } from '../types'

export const MAX_PROPERTY_IMAGES = 6
export const MAX_PROPERTY_IMAGE_BYTES = 5 * 1024 * 1024

export async function getProperties(filters: PropertyFilters = {}): Promise<PropertyListResponse> {
  const params: Record<string, string | number> = {}
  if (filters.city?.trim()) params.city = filters.city.trim()
  if (filters.listingType) params.listingType = filters.listingType
  if (filters.propertyType) params.propertyType = filters.propertyType
  if (filters.bhk) params.bhk = filters.bhk
  const response = await api.get<PropertyListResponse>('/properties', { params })
  return response.data
}

export async function getProperty(id: string): Promise<Property> {
  const response = await api.get<{ property: Property }>(`/properties/${encodeURIComponent(id)}`)
  return response.data.property
}

export async function getMyListings(): Promise<PropertyListResponse> {
  const response = await api.get<PropertyListResponse>('/properties/my/listings')
  return response.data
}

export async function createProperty(payload: PropertyPayload): Promise<{ property: Property; predictedPriceLakhs: number | null }> {
  const response = await api.post<{ property: Property; predictedPriceLakhs: number | null }>('/properties', payload)
  return response.data
}

export async function updateProperty(id: string, payload: PropertyPayload): Promise<{ property: Property; predictedPriceLakhs: number | null }> {
  const response = await api.patch<{ property: Property; predictedPriceLakhs: number | null }>(`/properties/${encodeURIComponent(id)}`, payload)
  return response.data
}

export async function uploadPropertyImages(
  files: File[],
  onProgress: (percentage: number) => void,
): Promise<string[]> {
  const formData = new FormData()
  files.forEach((file) => formData.append('images', file))
  const response = await api.post<{ images: Array<{ secureUrl: string }> }>(
    '/properties/images',
    formData,
    {
      onUploadProgress: (event) => {
        if (event.total) onProgress(Math.round((event.loaded / event.total) * 100))
      },
    },
  )
  return response.data.images.map((image) => image.secureUrl)
}

export async function deletePropertyImage(secureUrl: string): Promise<void> {
  await api.delete('/properties/images', { data: { secureUrl } })
}

export async function getPendingListings(): Promise<PropertyListResponse> {
  const response = await api.get<PropertyListResponse>('/properties/admin/pending')
  return response.data
}

export async function setPropertyStatus(id: string, status: Extract<PropertyStatus, 'APPROVED' | 'REJECTED'>): Promise<Property> {
  const response = await api.patch<{ property: Property }>(`/properties/${encodeURIComponent(id)}/status`, { status })
  return response.data.property
}

export const propertyTypeOptions: PropertyType[] = ['APARTMENT', 'VILLA', 'HOUSE', 'PLOT', 'COMMERCIAL']
export const listingTypeOptions: ListingType[] = ['SALE', 'RENT']
