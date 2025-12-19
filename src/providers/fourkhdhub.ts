import type { Provider, ProviderLink, Subtitle } from '../types/index.js'
import axios from 'axios'
import * as cheerio from 'cheerio'

/**
 * 4KHDHub streaming provider
 * High-quality movie and TV show downloads from 4KHDHub
 */

const TMDB_API_KEY =
  process.env.TMDB_API_KEY || '439c478a771f35c05022f9feabcca01c'
const BASE_URL = 'https://4khdhub.fans'

// Utility functions
function rot13(str: string): string {
  return str.replace(/[A-Za-z]/g, char => {
    const start = char <= 'Z' ? 65 : 97
    return String.fromCharCode(((char.charCodeAt(0) - start + 13) % 26) + start)
  })
}

function base64Decode(str: string): string {
  return Buffer.from(str, 'base64').toString('utf-8')
}

function calculateLevenshtein(str1: string, str2: string): number {
  const s1 = str1.toLowerCase()
  const s2 = str2.toLowerCase()

  const len1 = s1.length
  const len2 = s2.length

  if (len1 === 0) return len2
  if (len2 === 0) return len1

  const matrix = Array(len1 + 1)
    .fill(null)
    .map(() => Array(len2 + 1).fill(0))

  for (let i = 0; i <= len1; i++) matrix[i][0] = i
  for (let j = 0; j <= len2; j++) matrix[0][j] = j

  for (let i = 1; i <= len1; i++) {
    for (let j = 1; j <= len2; j++) {
      const cost = s1[i - 1] === s2[j - 1] ? 0 : 1
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      )
    }
  }

  return matrix[len1][len2]
}

async function getTMDBDetails(
  tmdbId: string,
  mediaType: 'movie' | 'tv'
): Promise<{ title: string; year: number } | null> {
  try {
    const response = await axios.get(
      `https://api.themoviedb.org/3/${mediaType}/${tmdbId}?api_key=${TMDB_API_KEY}`,
      { timeout: 10000 }
    )
    const data = response.data

    if (mediaType === 'movie') {
      return {
        title: data.title,
        year: data.release_date ? parseInt(data.release_date.split('-')[0]) : 0,
      }
    } else {
      return {
        title: data.name,
        year: data.first_air_date
          ? parseInt(data.first_air_date.split('-')[0])
          : 0,
      }
    }
  } catch (error) {
    console.error(
      `[4KHDHub] TMDB fetch error: ${error instanceof Error ? error.message : 'Unknown error'}`
    )
    return null
  }
}

async function fetchPageUrl(
  name: string,
  year: number,
  isSeries: boolean
): Promise<string | null> {
  try {
    const searchUrl = `${BASE_URL}/?s=${encodeURIComponent(`${name} ${year}`)}`
    const response = await axios.get(searchUrl, { timeout: 15000 })
    const $ = cheerio.load(response.data)

    const contentType = isSeries ? 'Series' : 'Movies'

    const matchingCards = $(
      `.movie-card:has(.movie-card-format:contains("${contentType}"))`
    )
      .filter((_i, el) => {
        const movieCardYear = parseInt($('.movie-card-meta', el).text())
        return Math.abs(movieCardYear - year) <= 1
      })
      .filter((_i, el) => {
        const movieCardTitle = $('.movie-card-title', el)
          .text()
          .replace(/\[.*?]/, '')
          .trim()
        return calculateLevenshtein(movieCardTitle, name) < 5
      })

    if (matchingCards.length === 0) return null

    const href = $(matchingCards.get(0)).attr('href')
    return href ? new URL(href, BASE_URL).toString() : null
  } catch (error) {
    console.error(
      `[4KHDHub] Search error: ${error instanceof Error ? error.message : 'Unknown error'}`
    )
    return null
  }
}

async function resolveRedirectUrl(redirectUrl: string): Promise<string | null> {
  try {
    const response = await axios.get(redirectUrl, { timeout: 10000 })
    const redirectDataMatch = response.data.match(/'o','(.*?)'/)
    if (!redirectDataMatch) return null

    const redirectData = JSON.parse(
      base64Decode(rot13(base64Decode(base64Decode(redirectDataMatch[1]))))
    )
    return base64Decode(redirectData['o'])
  } catch (error) {
    console.error(
      `[4KHDHub] Redirect error: ${error instanceof Error ? error.message : 'Unknown error'}`
    )
    return null
  }
}

async function extractSourceResults(
  $: cheerio.CheerioAPI,
  el: cheerio.Element
): Promise<ProviderLink | null> {
  try {
    const localHtml = $(el).html() || ''

    const sizeMatch = localHtml.match(/([\d.]+ ?[GM]B)/)
    const heightMatch = localHtml.match(/\d{3,}p/)

    const title = $('.file-title, .episode-file-title', el).text().trim()
    const size = sizeMatch ? sizeMatch[1] : ''
    const quality = heightMatch ? heightMatch[0] : '1080p'

    // Try HubCloud first
    const hubCloudLink = $('a', el)
      .filter((_i, el) => $(el).text().includes('HubCloud'))
      .attr('href')

    if (hubCloudLink) {
      const resolvedUrl = await resolveRedirectUrl(hubCloudLink)
      if (resolvedUrl) {
        return {
          server: '4KHDHub - HubCloud',
          url: resolvedUrl,
          isM3U8: false,
          quality: `${title} | ${size} | ${quality}`,
          subtitles: [] as Subtitle[],
        }
      }
    }

    // Try HubDrive as fallback
    const hubDriveLink = $('a', el)
      .filter((_i, el) => $(el).text().includes('HubDrive'))
      .attr('href')

    if (hubDriveLink) {
      const resolvedUrl = await resolveRedirectUrl(hubDriveLink)
      if (resolvedUrl) {
        // HubDrive may redirect to HubCloud
        const hubDriveResponse = await axios.get(resolvedUrl, {
          timeout: 10000,
        })
        const $2 = cheerio.load(hubDriveResponse.data)
        const finalUrl = $2('a:contains("HubCloud")').attr('href')

        if (finalUrl) {
          return {
            server: '4KHDHub - HubDrive',
            url: finalUrl,
            isM3U8: false,
            quality: `${title} | ${size} | ${quality}`,
            subtitles: [] as Subtitle[],
          }
        }
      }
    }

    return null
  } catch (error) {
    console.error(
      `[4KHDHub] Extract error: ${error instanceof Error ? error.message : 'Unknown error'}`
    )
    return null
  }
}

async function get4KHDHubStreams(
  tmdbId: string,
  type: 'movie' | 'tv',
  season?: number,
  episode?: number
): Promise<ProviderLink[]> {
  try {
    console.log(
      `[4KHDHub] Searching for TMDB ${type}/${tmdbId}${season ? ` S${season}E${episode}` : ''}`
    )

    const tmdbDetails = await getTMDBDetails(tmdbId, type)
    if (!tmdbDetails) {
      console.error('[4KHDHub] Failed to get TMDB details')
      return []
    }

    console.log(
      `[4KHDHub] Searching for: ${tmdbDetails.title} (${tmdbDetails.year})`
    )

    const pageUrl = await fetchPageUrl(
      tmdbDetails.title,
      tmdbDetails.year,
      type === 'tv'
    )
    if (!pageUrl) {
      console.log('[4KHDHub] No matching page found')
      return []
    }

    const response = await axios.get(pageUrl, { timeout: 15000 })
    const $ = cheerio.load(response.data)

    if (type === 'tv' && season && episode) {
      // Find episodes matching the season
      const episodeItems = $('.episode-item').filter((_i, el) =>
        $('.episode-title', el)
          .text()
          .includes(`S${String(season).padStart(2, '0')}`)
      )

      const results: ProviderLink[] = []

      for (const item of episodeItems.get()) {
        const downloadItems = $('.episode-download-item', item).filter(
          (_i, el) =>
            $(el)
              .text()
              .includes(`Episode-${String(episode).padStart(2, '0')}`)
        )

        for (const downloadItem of downloadItems.get()) {
          const result = await extractSourceResults($, downloadItem)
          if (result) results.push(result)
        }
      }

      console.log(`[4KHDHub] Found ${results.length} episode links`)
      return results
    } else {
      // Movie
      const downloadItems = $('.download-item')
      const results: ProviderLink[] = []

      for (const item of downloadItems.get()) {
        const result = await extractSourceResults($, item)
        if (result) results.push(result)
      }

      console.log(`[4KHDHub] Found ${results.length} movie links`)
      return results
    }
  } catch (error) {
    console.error(
      `[4KHDHub] Error: ${error instanceof Error ? error.message : 'Unknown error'}`
    )
    return []
  }
}

export const fourKHDHubProvider: Provider = {
  name: '4KHDHub',
  id: '4khdhub',

  async streamMovie(tmdbId: string): Promise<ProviderLink[]> {
    return get4KHDHubStreams(tmdbId, 'movie')
  },

  async streamTV(
    tmdbId: string,
    season: number,
    episode: number
  ): Promise<ProviderLink[]> {
    return get4KHDHubStreams(tmdbId, 'tv', season, episode)
  },
}
