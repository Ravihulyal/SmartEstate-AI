import { ImageOff } from 'lucide-react'
import { useState } from 'react'

interface FallbackImageProps {
  src?: string
  alt: string
  className?: string
  loading?: 'eager' | 'lazy'
}

export function FallbackImage({ src, alt, className, loading }: FallbackImageProps) {
  const [failedSrc, setFailedSrc] = useState('')

  if (!src || failedSrc === src) {
    return (
      <div className={`image-fallback${className ? ` ${className}` : ''}`} role="img" aria-label={alt ? `${alt} (image unavailable)` : 'Image unavailable'}>
        <ImageOff size={20} aria-hidden="true" />
        <span>Image unavailable</span>
      </div>
    )
  }

  return <img src={src} alt={alt} loading={loading} onError={() => setFailedSrc(src)} />
}
