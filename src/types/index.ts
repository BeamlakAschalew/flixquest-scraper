import type { Stream } from '@p-stream/providers'

export interface StreamMovieRequest {
  tmdbId: string
}

export interface StreamTVRequest {
  tmdbId: string
  season: number
  episode: number
}

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
    qualities?: any
    flags: string[]
    captions: any[]
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
