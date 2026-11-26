const FAVORITES_KEY = 'smartestate_favorites'

export function getFavoriteIds(): string[] {
  try {
    const saved: unknown = JSON.parse(window.localStorage.getItem(FAVORITES_KEY) ?? '[]')
    return Array.isArray(saved) && saved.every((item) => typeof item === 'string') ? saved : []
  } catch {
    return []
  }
}

export function toggleFavoriteId(id: string): string[] {
  const current = getFavoriteIds()
  const next = current.includes(id) ? current.filter((favorite) => favorite !== id) : [...current, id]
  window.localStorage.setItem(FAVORITES_KEY, JSON.stringify(next))
  return next
}
