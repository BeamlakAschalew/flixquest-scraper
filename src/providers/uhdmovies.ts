import * as cheerio from 'cheerio'
import type { Provider, ProviderLink, Subtitle } from '../types/index.js'

/**
 * UHDMovies streaming provider integration
 * TypeScript version - Downloads high quality movie/TV files
 */

// Constants
const TMDB_API_KEY = '439c478a771f35c05022f9feabcca01c'
let uhdMoviesDomain = 'https://uhdmovies.email'
let domainCacheTimestamp = 0
const DOMAIN_CACHE_TTL = 4 * 60 * 60 * 1000 // 4 hours

// Default headers
const DEFAULT_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
  Accept:
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.5',
  Connection: 'keep-alive',
  'Upgrade-Insecure-Requests': '1',
}

/**
 * Make HTTP request with default headers
 */
async function makeRequest(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  const headers = {
    ...DEFAULT_HEADERS,
    ...(options.headers as Record<string, string>),
  }

  try {
    const response = await fetch(url, {
      method: options.method || 'GET',
      headers,
      redirect: 'follow',
      ...options,
    })

    return response
  } catch (error) {
    console.error(
      `[UHDMovies] Request failed for ${url}: ${error instanceof Error ? error.message : 'Unknown error'}`
    )
    throw error
  }
}

/**
 * Get the latest UHDMovies domain
 */
async function getUHDMoviesDomain(): Promise<string> {
  const now = Date.now()
  if (now - domainCacheTimestamp < DOMAIN_CACHE_TTL) {
    return uhdMoviesDomain
  }

  try {
    console.log('[UHDMovies] Fetching latest domain...')
    const response = await makeRequest(
      'https://raw.githubusercontent.com/phisher98/TVVVV/refs/heads/main/domains.json'
    )
    const data = (await response.json()) as { UHDMovies?: string }
    if (data && data.UHDMovies) {
      uhdMoviesDomain = data.UHDMovies
      domainCacheTimestamp = now
      console.log(`[UHDMovies] Updated domain to: ${uhdMoviesDomain}`)
    }
  } catch (error) {
    console.error(
      `[UHDMovies] Failed to fetch latest domain: ${error instanceof Error ? error.message : 'Unknown error'}`
    )
  }
  return uhdMoviesDomain
}

/**
 * Search result interface
 */
interface SearchResult {
  title: string
  link: string
  score?: number
}

/**
 * Download link info
 */
interface DownloadLink {
  quality: string
  size: string
  link: string
  rawQuality: string
}

/**
 * Media info from TMDB
 */
interface MediaInfo {
  title: string
  year: number
}

/**
 * Search for movies/shows on UHDMovies
 */
async function searchMovies(query: string): Promise<SearchResult[]> {
  try {
    const baseUrl = await getUHDMoviesDomain()
    console.log(`[UHDMovies] Searching for: ${query}`)
    const searchUrl = `${baseUrl}/search/${encodeURIComponent(query)}`

    const response = await makeRequest(searchUrl)
    const html = await response.text()
    const $ = cheerio.load(html)

    const searchResults: SearchResult[] = []

    // Grid-based search results
    $('article.gridlove-post').each((_, element) => {
      const linkElement = $(element).find('a[href*="/download-"]')
      if (linkElement.length > 0) {
        const link = linkElement.first().attr('href')
        const title =
          linkElement.first().attr('title') ||
          $(element).find('h1.sanket').text().trim()

        if (link && title && !searchResults.some(item => item.link === link)) {
          searchResults.push({
            title,
            link: link.startsWith('http') ? link : `${baseUrl}${link}`,
          })
        }
      }
    })

    // Fallback list-based search
    if (searchResults.length === 0) {
      $('a[href*="/download-"]').each((_, element) => {
        const link = $(element).attr('href')
        if (link && !searchResults.some(item => item.link === link)) {
          const title = $(element).text().trim()
          if (title) {
            searchResults.push({
              title,
              link: link.startsWith('http') ? link : `${baseUrl}${link}`,
            })
          }
        }
      })
    }

    console.log(`[UHDMovies] Found ${searchResults.length} results`)
    return searchResults
  } catch (error) {
    console.error(
      `[UHDMovies] Error searching: ${error instanceof Error ? error.message : 'Unknown error'}`
    )
    return []
  }
}

/**
 * Extract clean quality info from verbose text
 */
function extractCleanQuality(fullQualityText: string): string {
  if (!fullQualityText || fullQualityText === 'Unknown Quality') {
    return 'Unknown Quality'
  }

  const cleanedText = fullQualityText
    .replace(
      /(\u00a9|\u00ae|[\u2000-\u3300]|\ud83c[\ud000-\udfff]|\ud83d[\ud000-\udfff]|\ud83e[\ud000-\udfff])/g,
      ''
    )
    .trim()
  const text = cleanedText.toLowerCase()
  const quality: string[] = []

  // Resolution
  if (text.includes('2160p') || text.includes('4k')) quality.push('4K')
  else if (text.includes('1080p')) quality.push('1080p')
  else if (text.includes('720p')) quality.push('720p')
  else if (text.includes('480p')) quality.push('480p')

  // Special features
  if (text.includes('hdr')) quality.push('HDR')
  if (
    text.includes('dolby vision') ||
    text.includes('dovi') ||
    /\bdv\b/.test(text)
  )
    quality.push('DV')
  if (text.includes('imax')) quality.push('IMAX')
  if (text.includes('bluray') || text.includes('blu-ray'))
    quality.push('BluRay')

  if (quality.length > 0) {
    return quality.join(' | ')
  }

  // Truncate if too long
  if (cleanedText.length > 80) {
    return cleanedText.substring(0, 77).replace(/x265/gi, 'HEVC') + '...'
  }

  return cleanedText.replace(/x265/gi, 'HEVC')
}

/**
 * Extract download links for movies
 */
async function extractDownloadLinks(
  moviePageUrl: string,
  targetYear: number | null = null
): Promise<{ title: string; links: DownloadLink[] }> {
  try {
    console.log(`[UHDMovies] Extracting links from: ${moviePageUrl}`)
    const response = await makeRequest(moviePageUrl)
    const html = await response.text()
    const $ = cheerio.load(html)

    const movieTitle = $('h1').first().text().trim()
    const downloadLinks: DownloadLink[] = []

    $('a[href*="?sid="], a[href*="&sid="]').each((_, element) => {
      const link = $(element).attr('href')
      const className = $(element).attr('class') || ''
      const buttonText = $(element).text().replace(/\s+/g, ' ').trim()
      if (!/maxbutton/i.test(className) && !/download/i.test(buttonText)) return

      if (link && !downloadLinks.some(item => item.link === link)) {
        const linkText = buttonText
        let quality = /2160|1080|720|480|4k|uhd|hdr|dovi|remux/i.test(linkText)
          ? linkText
          : 'Unknown Quality'
        let size = 'Unknown'

        // Look for quality in preceding elements
        const prevElement = $(element).closest('p').prev()
        if (prevElement.length > 0) {
          const prevText = prevElement.text().trim()
          if (
            quality === 'Unknown Quality' &&
            prevText &&
            prevText.length > 20 &&
            !prevText.includes('Download')
          ) {
            quality = prevText
          }
        }

        // Method 2: parent siblings
        if (quality === 'Unknown Quality') {
          const parentSiblings = $(element)
            .parent()
            .prevAll()
            .first()
            .text()
            .trim()
          if (parentSiblings && parentSiblings.length > 20) {
            quality = parentSiblings
          }
        }

        // Method 3: bold/strong text
        if (quality === 'Unknown Quality') {
          const strongText = $(element)
            .closest('p')
            .prevAll()
            .find('strong, b')
            .last()
            .text()
            .trim()
          if (strongText && strongText.length > 20) {
            quality = strongText
          }
        }

        // Year-based filtering
        if (targetYear && quality !== 'Unknown Quality') {
          const yearMatches = quality.match(/\((\d{4})\)/g)
          let hasMatchingYear = false
          if (yearMatches && yearMatches.length > 0) {
            for (const yearMatch of yearMatches) {
              const year = parseInt(yearMatch.replace(/[()]/g, ''))
              if (year === targetYear) {
                hasMatchingYear = true
                break
              }
            }
            if (!hasMatchingYear) {
              console.log(
                `[UHDMovies] Skipping link due to year mismatch. Target: ${targetYear}`
              )
              return
            }
          }
        }

        // Extract size
        const sizeMatch = quality.match(/\[([0-9.,]+\s*[KMGT]B[^\]]*)\]/)
        if (sizeMatch) {
          size = sizeMatch[1]
        }

        const cleanQuality = extractCleanQuality(quality)
        downloadLinks.push({
          quality: cleanQuality,
          size,
          link,
          rawQuality: quality
            .replace(/(\r\n|\n|\r)/gm, ' ')
            .replace(/\s+/g, ' ')
            .trim(),
        })
      }
    })

    return { title: movieTitle, links: downloadLinks }
  } catch (error) {
    console.error(
      `[UHDMovies] Error extracting links: ${error instanceof Error ? error.message : 'Unknown error'}`
    )
    return { title: 'Unknown', links: [] }
  }
}

/**
 * Extract download links for TV shows
 */
async function extractTvShowDownloadLinks(
  showPageUrl: string,
  season: number,
  episode: number
): Promise<{ title: string; links: DownloadLink[]; seasonNotFound?: boolean }> {
  try {
    console.log(
      `[UHDMovies] Extracting TV show links from: ${showPageUrl} for S${season}E${episode}`
    )
    const response = await makeRequest(showPageUrl)
    const html = await response.text()
    const $ = cheerio.load(html)

    const showTitle = $('h1').first().text().trim()
    const downloadLinks: DownloadLink[] = []

    let inTargetSeason = false
    let qualityText = ''

    $('.entry-content')
      .find('*')
      .each((_, element) => {
        const $el = $(element)
        const text = $el.text().trim()
        const seasonMatch = text.match(/^SEASON\s+(\d+)/i)

        if (seasonMatch) {
          const currentSeasonNum = parseInt(seasonMatch[1], 10)
          if (currentSeasonNum === season) {
            inTargetSeason = true
            console.log(`[UHDMovies] Entering Season ${season} block.`)
          } else if (inTargetSeason) {
            inTargetSeason = false
            return false
          }
        }

        if (inTargetSeason) {
          const isQualityHeader = $el.is('pre, p:has(strong), p:has(b), h3, h4')
          if (isQualityHeader) {
            const headerText = $el.text().trim()
            if (
              headerText.length > 5 &&
              !/plot|download|screenshot|trailer|join|powered by|season/i.test(
                headerText
              ) &&
              !($el.find('a').length > 0)
            ) {
              qualityText = headerText
            }
          }

          // Check for episode links
          if (
            $el.is('p') &&
            $el.find('a[href*="?sid="], a[href*="&sid="]').length > 0
          ) {
            const episodeRegex = new RegExp(
              `^Episode\\s+0*${episode}(?!\\d)`,
              'i'
            )
            const targetEpisodeLink = $el
              .find('a')
              .filter((_, el) => episodeRegex.test($(el).text().trim()))
              .first()

            if (targetEpisodeLink.length > 0) {
              const link = targetEpisodeLink.attr('href')
              if (link && !downloadLinks.some(item => item.link === link)) {
                const sizeMatch = qualityText.match(
                  /\[\s*([0-9.,]+\s*[KMGT]B)/i
                )
                const size = sizeMatch ? sizeMatch[1] : 'Unknown'
                const cleanQuality = extractCleanQuality(qualityText)
                const rawQuality = qualityText
                  .replace(/(\r\n|\n|\r)/gm, ' ')
                  .replace(/\s+/g, ' ')
                  .trim()

                console.log(
                  `[UHDMovies] Found match: Quality='${cleanQuality}', Link='${link}'`
                )
                downloadLinks.push({
                  quality: cleanQuality,
                  size,
                  link,
                  rawQuality,
                })
              }
            }
          }

          // Check for maxbutton structure
          if (
            $el.is('p') &&
            $el.find('a.maxbutton-gdrive-episode').length > 0
          ) {
            const episodeRegex = new RegExp(
              `^Episode\\s+0*${episode}(?!\\d)`,
              'i'
            )
            const targetEpisodeLink = $el
              .find('a.maxbutton-gdrive-episode')
              .filter((_, el) => {
                const episodeText = $(el).find('.mb-text').text().trim()
                return episodeRegex.test(episodeText)
              })
              .first()

            if (targetEpisodeLink.length > 0) {
              const link = targetEpisodeLink.attr('href')
              if (link && !downloadLinks.some(item => item.link === link)) {
                const sizeMatch = qualityText.match(
                  /\[\s*([0-9.,]+\s*[KMGT]B)/i
                )
                const size = sizeMatch ? sizeMatch[1] : 'Unknown'
                const cleanQuality = extractCleanQuality(qualityText)
                const rawQuality = qualityText
                  .replace(/(\r\n|\n|\r)/gm, ' ')
                  .replace(/\s+/g, ' ')
                  .trim()

                console.log(
                  `[UHDMovies] Found match (maxbutton): Quality='${cleanQuality}', Link='${link}'`
                )
                downloadLinks.push({
                  quality: cleanQuality,
                  size,
                  link,
                  rawQuality,
                })
              }
            }
          }
        }
      })

    // Fallback logic if main extraction failed
    if (downloadLinks.length === 0) {
      console.log('[UHDMovies] Main extraction failed. Trying fallback...')

      // Check if season exists
      let seasonExists = false
      $('.entry-content')
        .find('*')
        .each((_, element) => {
          const text = $(element).text().trim()
          const seasonMatches = [
            text.match(/^SEASON\s+(\d+)/i),
            text.match(/\bSeason\s+(\d+)/i),
            text.match(/\bS(\d+)/i),
          ]
          for (const match of seasonMatches) {
            if (match) {
              const currentSeasonNum = parseInt(match[1], 10)
              if (currentSeasonNum === season) {
                seasonExists = true
                return false
              }
            }
          }
        })

      if (!seasonExists) {
        console.log(`[UHDMovies] Season ${season} not found on page.`)
        return { title: showTitle, links: [], seasonNotFound: true }
      }

      // Fallback: search all episode links
      $(
        '.entry-content a[href*="?sid="], .entry-content a[href*="&sid="]'
      ).each((_, el) => {
        const linkElement = $(el)
        const episodeRegex = new RegExp(`^Episode\\s+0*${episode}(?!\\d)`, 'i')

        if (episodeRegex.test(linkElement.text().trim())) {
          const link = linkElement.attr('href')
          if (link && !downloadLinks.some(item => item.link === link)) {
            let qualityText = 'Unknown Quality'
            const parentP = linkElement.closest('p, div')
            const prevElement = parentP.prev()
            if (prevElement.length > 0) {
              const prevText = prevElement.text().trim()
              if (
                prevText &&
                prevText.length > 5 &&
                !prevText.toLowerCase().includes('download')
              ) {
                qualityText = prevText
              }
            }

            // Season check in quality text
            const seasonCheckRegexes = [
              new RegExp(`\\.S0*${season}[\\.]`, 'i'),
              new RegExp(`S0*${season}[\\.]`, 'i'),
              new RegExp(`S0*${season}\\b`, 'i'),
              new RegExp(`Season\\s+0*${season}\\b`, 'i'),
            ]
            const seasonMatch = seasonCheckRegexes.some(regex =>
              regex.test(qualityText)
            )
            if (!seasonMatch) {
              return
            }

            const sizeMatch = qualityText.match(/\[([0-9.,]+[KMGT]B[^\]]*)\]/i)
            const size = sizeMatch ? sizeMatch[1] : 'Unknown'
            const cleanQuality = extractCleanQuality(qualityText)
            const rawQuality = qualityText
              .replace(/(\r\n|\n|\r)/gm, ' ')
              .replace(/\s+/g, ' ')
              .trim()

            console.log(
              `[UHDMovies] Found match via fallback: Quality='${cleanQuality}'`
            )
            downloadLinks.push({
              quality: cleanQuality,
              size,
              link,
              rawQuality,
            })
          }
        }
      })
    }

    console.log(
      `[UHDMovies] Found ${downloadLinks.length} links for S${season}E${episode}.`
    )
    return { title: showTitle, links: downloadLinks }
  } catch (error) {
    console.error(
      `[UHDMovies] Error extracting TV show links: ${error instanceof Error ? error.message : 'Unknown error'}`
    )
    return { title: 'Unknown', links: [] }
  }
}

/**
 * Simple cookie storage for SID resolution
 */
class SimpleCookieJar {
  private cookies: Map<string, string> = new Map()

  setCookie(name: string, value: string): void {
    this.cookies.set(name, value)
  }

  getCookieString(): string {
    const parts: string[] = []
    this.cookies.forEach((value, name) => {
      parts.push(`${name}=${value}`)
    })
    return parts.join('; ')
  }
}

/**
 * Resolve SID link to driveleech URL
 */
async function resolveSidToDriveleech(sidUrl: string): Promise<string | null> {
  console.log(`[UHDMovies] Resolving SID link: ${sidUrl}`)
  const origin = new URL(sidUrl).origin
  const cookieJar = new SimpleCookieJar()

  try {
    // Step 0: Fetch initial page
    console.log('  [SID] Step 0: Fetching initial page...')
    const response0 = await makeRequest(sidUrl)
    let html = await response0.text()
    let $ = cheerio.load(html)

    const initialForm = $('#landing')
    const wpHttp = initialForm.find('input[name="_wp_http"]').val() as string
    const actionUrl1 = initialForm.attr('action')

    if (!wpHttp || !actionUrl1) {
      console.error('  [SID] Error: Could not find _wp_http in initial form.')
      return null
    }

    // Step 1: Submit first form
    console.log('  [SID] Step 1: Submitting initial form...')
    const formData1 = new URLSearchParams({ _wp_http: wpHttp })
    const response1 = await makeRequest(actionUrl1, {
      method: 'POST',
      body: formData1.toString(),
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Referer: sidUrl,
      },
    })
    html = await response1.text()

    // Step 2: Parse verification page
    console.log('  [SID] Step 2: Parsing verification page...')
    $ = cheerio.load(html)
    const verificationForm = $('#landing')
    const actionUrl2 = verificationForm.attr('action')
    const wpHttp2 = verificationForm
      .find('input[name="_wp_http2"]')
      .val() as string
    const token = verificationForm.find('input[name="token"]').val() as string

    if (!actionUrl2) {
      console.error('  [SID] Error: Could not find verification form.')
      return null
    }

    // Step 3: Submit verification
    console.log('  [SID] Step 3: Submitting verification...')
    const formData2 = new URLSearchParams({
      _wp_http2: wpHttp2 || '',
      token: token || '',
    })
    const response2 = await makeRequest(actionUrl2, {
      method: 'POST',
      body: formData2.toString(),
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Referer: response1.url,
      },
    })
    const html2 = await response2.text()

    // Step 4: Find dynamic cookie and link from JavaScript
    console.log('  [SID] Step 4: Parsing final page for JS data...')
    const cookieMatch = html2.match(/s_343\('([^']+)',\s*'([^']+)'/)
    const linkMatch = html2.match(/c\.setAttribute\("href",\s*"([^"]+)"\)/)

    let cookieName: string | null = null
    let cookieValue: string | null = null
    let finalLinkPath: string | null = null

    if (cookieMatch) {
      cookieName = cookieMatch[1].trim()
      cookieValue = cookieMatch[2].trim()
    }
    if (linkMatch) {
      finalLinkPath = linkMatch[1].trim()
    }

    if (!finalLinkPath || !cookieName || !cookieValue) {
      console.error(
        '  [SID] Error: Could not extract dynamic cookie/link from JS.'
      )
      return null
    }

    const finalUrl = new URL(finalLinkPath, origin).href
    console.log(`  [SID] Dynamic link found: ${finalUrl}`)

    // Step 5: Set cookie and make final request
    console.log('  [SID] Step 5: Setting cookie and making final request...')
    cookieJar.setCookie(cookieName, cookieValue)

    const response3 = await makeRequest(finalUrl, {
      headers: {
        Referer: response2.url,
        Cookie: cookieJar.getCookieString(),
      },
    })
    const html3 = await response3.text()

    // Step 6: Extract driveleech URL from meta refresh
    $ = cheerio.load(html3)
    const metaRefresh = $('meta[http-equiv="refresh"]')
    if (metaRefresh.length > 0) {
      const content = metaRefresh.attr('content') || ''
      const urlMatch = content.match(/url=(.*)/i)
      if (urlMatch && urlMatch[1]) {
        const driveleechUrl = urlMatch[1].replace(/"/g, '').replace(/'/g, '')
        console.log(
          `  [SID] SUCCESS! Resolved Driveleech URL: ${driveleechUrl}`
        )
        return driveleechUrl
      }
    }

    console.error('  [SID] Error: Could not find meta refresh tag.')
    return null
  } catch (error) {
    console.error(
      `  [SID] Error during SID resolution: ${error instanceof Error ? error.message : 'Unknown error'}`
    )
    return null
  }
}

/**
 * Try to extract final download URL from driveleech page
 */
async function extractFinalDownloadUrl(
  driveleechUrl: string
): Promise<{ url: string; size: string; fileName: string | null } | null> {
  try {
    console.log(`[UHDMovies] Processing driveleech URL: ${driveleechUrl}`)

    const response = await makeRequest(driveleechUrl)
    let html = await response.text()
    let $ = cheerio.load(html)

    // Check for JavaScript redirect
    const scriptContent = $('script').html() || ''
    const redirectMatch = scriptContent.match(
      /window\.location\.replace\("([^"]+)"\)/
    )
    if (redirectMatch && redirectMatch[1]) {
      const newPath = redirectMatch[1]
      const newUrl = new URL(newPath, new URL(driveleechUrl).origin).href
      console.log(`[UHDMovies] Following JS redirect to: ${newUrl}`)
      const response2 = await makeRequest(newUrl)
      html = await response2.text()
      $ = cheerio.load(html)
    }

    // Extract size and filename
    let sizeInfo = 'Unknown'
    let fileName: string | null = null

    const sizeElement = $('li.list-group-item:contains("Size :")').text()
    if (sizeElement) {
      const sizeMatch = sizeElement.match(/Size\s*:\s*([0-9.,]+\s*[KMGT]B)/i)
      if (sizeMatch) sizeInfo = sizeMatch[1]
    }

    const nameElement = $('li.list-group-item:contains("Name :")').text()
    if (nameElement) {
      fileName = nameElement.replace('Name :', '').trim()
    }

    // Try Resume Cloud method
    const resumeCloudButton = $(
      'a:contains("Resume Cloud"), a:contains("Cloud Resume Download"), a:contains("Worker")'
    )
    if (resumeCloudButton.length > 0) {
      let resumeLink = resumeCloudButton.attr('href')
      if (resumeLink) {
        // Direct workers.dev link
        if (resumeLink.includes('workers.dev')) {
          const urlParts = resumeLink.split('/')
          const filename = urlParts[urlParts.length - 1]
          urlParts[urlParts.length - 1] = filename.replace(/ /g, '%20')
          resumeLink = urlParts.join('/')
          console.log(
            `[UHDMovies] Found direct Resume Cloud link: ${resumeLink}`
          )
          return { url: resumeLink, size: sizeInfo, fileName }
        }

        // Follow link to get final download
        try {
          const resumeUrl = new URL(resumeLink, new URL(driveleechUrl).origin)
            .href
          const resumeResponse = await makeRequest(resumeUrl)
          const resumeHtml = await resumeResponse.text()
          const $$ = cheerio.load(resumeHtml)

          let finalLink = $$(
            'a.btn-success[href*="workers.dev"], a[href*="workerseed"], a[href*="driveleech.net/d/"], a[href*="driveseed.org/d/"]'
          ).attr('href')

          if (!finalLink) {
            finalLink = $$(
              'a[href*="workers.dev"], a[href*="workerseed"], a[href*="driveleech.net/d/"]'
            )
              .first()
              .attr('href')
          }

          if (finalLink) {
            if (finalLink.includes('workers.dev')) {
              const urlParts = finalLink.split('/')
              const filename = urlParts[urlParts.length - 1]
              urlParts[urlParts.length - 1] = filename.replace(/ /g, '%20')
              finalLink = urlParts.join('/')
            }
            console.log(`[UHDMovies] Extracted Resume Cloud link: ${finalLink}`)
            return { url: finalLink, size: sizeInfo, fileName }
          }
        } catch (e) {
          console.log(`[UHDMovies] Error following Resume Cloud link: ${e}`)
        }
      }
    }

    // Try Instant Download method
    const instantDownloadLink = $('a:contains("Instant Download")').attr('href')
    if (instantDownloadLink) {
      try {
        const instantUrl = new URL(
          instantDownloadLink,
          new URL(driveleechUrl).origin
        )
        if (
          /cdn\.video-gen\.xyz|workers\.dev|\.r2\.dev/i.test(
            instantUrl.hostname
          ) ||
          /\.(mkv|mp4|m3u8)(?:[?#]|$)/i.test(instantUrl.href)
        ) {
          const directUrl = await unwrapMediaRedirect(
            instantUrl.href,
            driveleechUrl
          )
          console.log(
            `[UHDMovies] Found direct Instant Download link: ${directUrl}`
          )
          return { url: directUrl, size: sizeInfo, fileName }
        }

        const urlParams = new URLSearchParams(instantUrl.search)
        const keys = urlParams.get('url')
        if (keys) {
          const apiUrl = `${new URL(instantDownloadLink).origin}/api`
          const formData = new URLSearchParams({ keys })

          const apiResponse = await fetch(apiUrl, {
            method: 'POST',
            body: formData.toString(),
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              'x-token': new URL(instantDownloadLink).hostname,
            },
          })
          const apiData = (await apiResponse.json()) as { url?: string }

          if (apiData && apiData.url) {
            let finalUrl = apiData.url
            if (finalUrl.includes('workers.dev')) {
              const urlParts = finalUrl.split('/')
              const filename = urlParts[urlParts.length - 1]
              urlParts[urlParts.length - 1] = filename.replace(/ /g, '%20')
              finalUrl = urlParts.join('/')
            }
            console.log(
              `[UHDMovies] Extracted Instant Download link: ${finalUrl}`
            )
            return { url: finalUrl, size: sizeInfo, fileName }
          }
        }
      } catch (e) {
        console.log(`[UHDMovies] Error with Instant Download: ${e}`)
      }
    }

    // Final fallback: look for any direct links
    const anyDirect = $(
      'a[href*="workers.dev"], a[href*="driveleech.net/d/"], a[href*="driveseed.org/d/"]'
    ).attr('href')
    if (anyDirect) {
      let direct = anyDirect
      if (direct.includes('workers.dev')) {
        const parts = direct.split('/')
        const fn = parts[parts.length - 1]
        parts[parts.length - 1] = fn.replace(/ /g, '%20')
        direct = parts.join('/')
      }
      console.log(`[UHDMovies] Found fallback direct link: ${direct}`)
      return { url: direct, size: sizeInfo, fileName }
    }

    console.log('[UHDMovies] All download methods failed.')
    return null
  } catch (error) {
    console.error(
      `[UHDMovies] Error extracting final download: ${error instanceof Error ? error.message : 'Unknown error'}`
    )
    return null
  }
}

async function unwrapMediaRedirect(
  url: string,
  referer: string
): Promise<string> {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': DEFAULT_HEADERS['User-Agent'],
        Referer: referer,
        Range: 'bytes=0-0',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(15_000),
    })
    const finalUrl = response.url || url
    await response.body?.cancel()

    const parsed = new URL(finalUrl)
    for (const key of ['url', 'link', 'd']) {
      const embedded = parsed.searchParams.get(key)
      if (embedded && /^https?:\/\//i.test(embedded)) {
        return new URL(embedded).href
      }
    }
    return finalUrl
  } catch {
    return url
  }
}

/**
 * Compare media info to search result
 */
function compareMedia(
  mediaInfo: MediaInfo,
  searchResult: SearchResult
): boolean {
  const tokenize = (str: string) =>
    String(str || '')
      .toLowerCase()
      .replace(/\bdownload\b/g, ' ')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
      .split(/\s+/)
      .filter(Boolean)

  const containsTokenSequence = (haystack: string[], needle: string[]) =>
    needle.length > 0 &&
    haystack.some((_token, index) =>
      needle.every((token, offset) => haystack[index + offset] === token)
    )

  const titleWithAnd = mediaInfo.title.replace(/\s*&\s*/g, ' and ')
  const mediaTokens = tokenize(titleWithAnd)
  const resultTitleBeforeYear = searchResult.title.split(
    /\b(?:19[89]\d|20\d{2})\b/
  )[0]
  const resultTokens = tokenize(resultTitleBeforeYear)

  // Use whole-token phrase matching so short titles such as "Leo" do not
  // accidentally match unrelated results such as "Napoleon".
  let titleMatches = mediaTokens.every(
    (token, index) => resultTokens[index] === token
  )

  // Check for collection matches
  if (!titleMatches) {
    const andIndex = mediaTokens.indexOf('and')
    const mainTitle =
      andIndex > 0 ? mediaTokens.slice(0, andIndex) : mediaTokens
    const isCollection = resultTokens.some(token =>
      ['duology', 'trilogy', 'collection', 'saga'].includes(token)
    )

    if (isCollection && containsTokenSequence(resultTokens, mainTitle)) {
      titleMatches = true
    }
  }

  if (!titleMatches) return false

  // Check year
  if (mediaInfo.year && searchResult.title) {
    const yearRegex = /\b(19[89]\d|20\d{2})\b/g
    const yearMatches = searchResult.title.match(yearRegex)

    if (yearMatches) {
      const hasMatchingYear = yearMatches.some(
        yearStr => parseInt(yearStr) === mediaInfo.year
      )
      if (!hasMatchingYear) return false
    }
  }

  return true
}

/**
 * Score search results
 */
function scoreResult(
  title: string,
  requestedSeason: number | null = null
): number {
  let score = 0
  const lowerTitle = title.toLowerCase()

  // Quality scoring
  if (lowerTitle.includes('remux')) score += 10
  if (lowerTitle.includes('bluray') || lowerTitle.includes('blu-ray'))
    score += 8
  if (lowerTitle.includes('imax')) score += 6
  if (lowerTitle.includes('4k') || lowerTitle.includes('2160p')) score += 5
  if (
    lowerTitle.includes('dovi') ||
    lowerTitle.includes('dolby vision') ||
    /\bdv\b/.test(lowerTitle)
  )
    score += 4
  if (lowerTitle.includes('hdr')) score += 3
  if (lowerTitle.includes('1080p')) score += 2
  if (lowerTitle.includes('hevc') || lowerTitle.includes('x265')) score += 1

  // Season coverage scoring
  if (requestedSeason !== null) {
    const seasonRangeMatch = lowerTitle.match(/season\s+(\d+)\s*[–-]\s*(\d+)/i)
    if (seasonRangeMatch) {
      const startSeason = parseInt(seasonRangeMatch[1], 10)
      const endSeason = parseInt(seasonRangeMatch[2], 10)
      if (requestedSeason >= startSeason && requestedSeason <= endSeason) {
        score += 50
      }
    }

    const specificSeasonMatch = lowerTitle.match(/season\s+(\d+)/i)
    if (specificSeasonMatch) {
      const mentionedSeason = parseInt(specificSeasonMatch[1], 10)
      if (mentionedSeason === requestedSeason) {
        score += 30
      } else if (mentionedSeason < requestedSeason) {
        score -= 20
      }
    }
  }

  return score
}

/**
 * Get TMDB info
 */
async function getTmdbInfo(
  tmdbId: string,
  mediaType: 'movie' | 'tv'
): Promise<MediaInfo> {
  const tmdbUrl = `https://api.themoviedb.org/3/${mediaType === 'tv' ? 'tv' : 'movie'}/${tmdbId}?api_key=${TMDB_API_KEY}`
  const response = await makeRequest(tmdbUrl)
  const data = (await response.json()) as {
    name?: string
    title?: string
    first_air_date?: string
    release_date?: string
  }

  return {
    title: (mediaType === 'tv' ? data.name : data.title) || 'Unknown',
    year: parseInt(
      (
        (mediaType === 'tv' ? data.first_air_date : data.release_date) || ''
      ).split('-')[0],
      10
    ),
  }
}

/**
 * Main function to get UHDMovies streams
 */
async function getUHDMoviesStreams(
  tmdbId: string,
  mediaType: 'movie' | 'tv',
  season?: number,
  episode?: number
): Promise<ProviderLink[]> {
  console.log(
    `[UHDMovies] Fetching streams for TMDB ID: ${tmdbId}, Type: ${mediaType}${mediaType === 'tv' ? `, S${season}E${episode}` : ''}`
  )

  try {
    // Get TMDB info
    const mediaInfo = await getTmdbInfo(tmdbId, mediaType)
    if (!mediaInfo.title || mediaInfo.title === 'Unknown') {
      console.log('[UHDMovies] Could not get media info from TMDB')
      return []
    }
    console.log(
      `[UHDMovies] TMDB Info: "${mediaInfo.title}" (${mediaInfo.year || 'N/A'})`
    )

    // Search for the media
    let searchTitle = mediaInfo.title
      .replace(/:/g, '')
      .replace(/\s*&\s*/g, ' and ')
    let searchResults = await searchMovies(searchTitle)

    // Fallback search
    if (
      searchResults.length === 0 ||
      !searchResults.some(result => compareMedia(mediaInfo, result))
    ) {
      let fallbackTitle = mediaInfo.title.split(':')[0].trim()
      if (fallbackTitle.includes('and the')) {
        fallbackTitle = fallbackTitle.split('and the')[0].trim()
      }
      if (fallbackTitle !== searchTitle) {
        console.log(`[UHDMovies] Fallback search with: "${fallbackTitle}"`)
        const fallbackResults = await searchMovies(fallbackTitle)
        if (fallbackResults.length > 0) {
          searchResults = fallbackResults
        }
      }
    }

    if (searchResults.length === 0) {
      console.log(`[UHDMovies] No search results found`)
      return []
    }

    // Find matching results
    const matchingResults = searchResults.filter(result =>
      compareMedia(mediaInfo, result)
    )

    if (matchingResults.length === 0) {
      console.log(`[UHDMovies] No matching content found`)
      return []
    }

    // Score and select best result
    const scoredResults = matchingResults
      .map(result => ({
        ...result,
        score: scoreResult(
          result.title,
          mediaType === 'tv' ? (season ?? null) : null
        ),
      }))
      .sort((a, b) => b.score - a.score)

    const matchingResult = scoredResults[0]
    console.log(
      `[UHDMovies] Best match: "${matchingResult.title}" (score: ${matchingResult.score})`
    )

    // Extract download links
    let downloadInfo:
      | { title: string; links: DownloadLink[]; seasonNotFound?: boolean }
      | { title: string; links: DownloadLink[] } =
      mediaType === 'tv' && season !== undefined && episode !== undefined
        ? await extractTvShowDownloadLinks(matchingResult.link, season, episode)
        : await extractDownloadLinks(matchingResult.link, mediaInfo.year)

    // Try next best match if failed
    if (
      downloadInfo.links.length === 0 &&
      scoredResults.length > 1 &&
      ('seasonNotFound' in downloadInfo || mediaType === 'tv')
    ) {
      console.log(`[UHDMovies] Trying next best match...`)
      const nextBestMatch = scoredResults[1]
      downloadInfo =
        mediaType === 'tv' && season !== undefined && episode !== undefined
          ? await extractTvShowDownloadLinks(
              nextBestMatch.link,
              season,
              episode
            )
          : await extractDownloadLinks(nextBestMatch.link, mediaInfo.year)
    }

    if (downloadInfo.links.length === 0) {
      console.log('[UHDMovies] No download links found')
      return []
    }

    console.log(
      `[UHDMovies] Resolving ${downloadInfo.links.length} SID link(s)...`
    )

    // Resolve links - only one per unique resolution
    const providerLinks: ProviderLink[] = []
    const resolvedQualities = new Set<string>()

    for (const linkInfo of downloadInfo.links) {
      // Skip if we already have a successful link for this quality
      if (resolvedQualities.has(linkInfo.quality)) {
        console.log(
          `[UHDMovies] Skipping duplicate quality: ${linkInfo.quality}`
        )
        continue
      }

      try {
        let driveleechUrl: string | null = null

        if (
          linkInfo.link.includes('tech.unblockedgames.world') ||
          linkInfo.link.includes('tech.examzculture.in') ||
          linkInfo.link.includes('?sid=') ||
          linkInfo.link.includes('&sid=')
        ) {
          driveleechUrl = await resolveSidToDriveleech(linkInfo.link)
        } else if (
          linkInfo.link.includes('driveseed.org') ||
          linkInfo.link.includes('driveleech.net')
        ) {
          driveleechUrl = linkInfo.link
        }

        if (!driveleechUrl) continue

        const finalDownload = await extractFinalDownloadUrl(driveleechUrl)
        if (finalDownload) {
          providerLinks.push({
            server: 'UHDMovies',
            url: finalDownload.url,
            isM3U8: false,
            quality: linkInfo.quality,
            subtitles: [] as Subtitle[],
          })
          // Mark this quality as resolved
          resolvedQualities.add(linkInfo.quality)
          console.log(`[UHDMovies] Successfully resolved: ${linkInfo.quality}`)
        }
      } catch (error) {
        console.error(
          `[UHDMovies] Error resolving link for ${linkInfo.quality}: ${error instanceof Error ? error.message : 'Unknown error'}`
        )
      }
    }

    console.log(
      `[UHDMovies] Successfully resolved ${providerLinks.length} links`
    )
    return providerLinks
  } catch (error) {
    console.error(
      `[UHDMovies] Critical error: ${error instanceof Error ? error.message : 'Unknown error'}`
    )
    return []
  }
}

export const uhdmoviesProvider: Provider = {
  name: 'UHDMovies',
  id: 'uhdmovies',

  async streamMovie(tmdbId: string): Promise<ProviderLink[]> {
    return getUHDMoviesStreams(tmdbId, 'movie')
  },

  async streamTV(
    tmdbId: string,
    season: number,
    episode: number
  ): Promise<ProviderLink[]> {
    return getUHDMoviesStreams(tmdbId, 'tv', season, episode)
  },
}
