import type { Property } from '../types'

export function formatPropertyType(value: Property['propertyType']): string {
  return value.charAt(0) + value.slice(1).toLowerCase()
}
