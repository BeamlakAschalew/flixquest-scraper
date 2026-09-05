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

/**
 * One selectable subtitle track, as exposed by the subtitle search endpoint.
 *
 * Richer than {@link Subtitle}: clients rendering their own picker need the
 * language, provenance and hearing-impaired flags that a `<track>` element has
 * no room for.
 */
export interface SubtitleCatalogEntry {
  /** Unique within a response; `{provider}-{provider-specific id}`. */
  id: string
  /**
   * Subtitle file URL. Router-relative until the response is sent, then
   * absolute — always pointing back at this API, never at the upstream host.
   */
  url: string
  /** Human-readable language, e.g. `English (SDH)`. */
  display: string
  /** ISO 639 language code, e.g. `en`. */
  language: string
  /** Wire format the `url` serves. */
  format: SubtitleOutputFormat
  /** Encoding of the served file; always `UTF-8` after normalization. */
  encoding: string
  isHearingImpaired: boolean
  /** Provider that vended the entry. */
  source: SubtitleProviderId
  /** Flag image for the language, or an empty string when unmapped. */
  flagUrl: string
  /** Title the subtitle was matched against, when the provider reports one. */
  media: string
  /** Release the subtitle was cut for, when the provider reports one. */
  release?: string
  /** True when the upstream marks the track as machine-translated. */
  machineTranslated?: boolean
}

export interface SubtitleProvider {
  id: SubtitleProviderId
  name: string
  /**
   * Resolve every subtitle this provider offers for the given media.
   *
   * Implementations must resolve to `[]` (never throw) so one failing provider
   * cannot break a stream response or a catalog lookup.
   */
  catalog: (query: SubtitleQuery) => Promise<SubtitleCatalogEntry[]>
  /**
   * The same tracks in the compact shape embedded in stream responses.
   *
   * Implementations must resolve to `[]` (never throw) so one failing provider
   * cannot break a stream response.
   */
  search: (query: SubtitleQuery) => Promise<Subtitle[]>
}

/** Wire formats the subtitle passthrough endpoint can emit. */
export type SubtitleOutputFormat = 'srt' | 'vtt'
