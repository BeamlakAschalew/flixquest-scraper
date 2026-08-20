/* eslint-disable no-unused-vars */
export interface StreamMovieRequest {
  tmdbId: string
}

export interface StreamTVRequest {
  tmdbId: string
  season: number
  episode: number
}

// Uniform subtitle/caption interface
export interface Subtitle {
  file: string
  label: string
  kind: string
  default?: boolean
  s?: string
}

// Uniform provider link response interface
export interface ProviderLink {
  server: string
  url: string
  isM3U8: boolean
  isDASH?: boolean
  quality: string
  subtitles: Subtitle[]
  headers?: Record<string, string>
  // Internal proxy instruction: expose only this variant from an HLS master
  // while retaining its EXT-X-MEDIA audio and subtitle renditions.
  hlsVariant?: string
  // Internal proxy instruction: mark this HLS audio language as the default.
  hlsAudioLanguage?: string
  // Internal proxy instruction: expose only this DASH video height while
  // retaining the manifest's audio representation.
  dashVideoHeight?: number
  /** Signed token for the pre-download source-size estimator. */
  sizeToken?: string
  /** Internal size-estimator context; stripped from public responses. */
  sizeManifestUrl?: string
  sizeHlsVariantUrl?: string
  sizeHlsAudioGroup?: string
  // Browser clients cannot set some anti-hotlink headers. Such links must
  // remain behind the API proxy even when raw upstream URLs are requested.
  requiresProxy?: boolean
}

// Provider response interface
export interface ProviderResponse {
  success: boolean
  provider: string
  media?: {
    type: string
    title: string
    releaseYear: number
    tmdbId: string
  }
  links?: ProviderLink[]
  error?: string
  details?: string
}

// Legacy stream response (for backward compatibility)
export interface StreamResponse {
  success: boolean
  media?: {
    type: string
    title: string
    releaseYear: number
    tmdbId: string
  }
  stream?: {
    sourceId: string
    embedId?: string
    type: string
    id: string
    playlist?: string
    qualities?: unknown
    flags: string[]
    captions: unknown[]
    headers?: Record<string, string>
    preferredHeaders?: Record<string, string>
  }
  error?: string
}

export interface ErrorResponse {
  success: false
  error: string
  details?: string
}

// Provider interface for modular providers
export interface Provider {
  name: string
  alias?: string
  content?: string
  id: string
  streamMovie: (tmdbId: string) => Promise<ProviderLink[]>
  streamTV: (
    tmdbId: string,
    season: number,
    episode: number
  ) => Promise<ProviderLink[]>
}
