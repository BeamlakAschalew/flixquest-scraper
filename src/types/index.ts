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
  quality: string
  subtitles: Subtitle[]
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
  id: string
  streamMovie: (tmdbId: string) => Promise<ProviderLink[]>
  streamTV: (
    tmdbId: string,
    season: number,
    episode: number
  ) => Promise<ProviderLink[]>
}
