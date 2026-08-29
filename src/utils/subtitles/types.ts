/* eslint-disable no-unused-vars */
import type { Subtitle } from '../../types/index.js'

/** Identifiers of the supported fallback subtitle providers. */
export type SubtitleProviderId = 'natsuki' | 'wyzie'

/** Media coordinates a subtitle provider searches with. */
export interface SubtitleQuery {
  tmdbId: string
  /** TV only. */
  season?: number
  /** TV only. */
  episode?: number
}

export interface SubtitleProvider {
  id: SubtitleProviderId
  name: string
  /**
   * Resolve subtitles for the given media.
   *
   * Implementations must resolve to `[]` (never throw) so one failing provider
   * cannot break a stream response.
   */
  search: (query: SubtitleQuery) => Promise<Subtitle[]>
}

/** Wire formats the subtitle passthrough endpoint can emit. */
export type SubtitleOutputFormat = 'srt' | 'vtt'
