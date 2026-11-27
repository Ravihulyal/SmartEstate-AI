import { api } from './api'
import type { Property, PropertyListResponse } from '../types'

export async function getFavorites(): Promise<PropertyListResponse> {
  const response = await api.get<PropertyListResponse>('/favorites')
  return response.data
}

export async function addFavorite(propertyId: string): Promise<Property> {
  const response = await api.post<{ property: Property }>(`/favorites/${encodeURIComponent(propertyId)}`)
  return response.data.property
}

export async function removeFavorite(propertyId: string): Promise<void> {
  await api.delete(`/favorites/${encodeURIComponent(propertyId)}`)
}
