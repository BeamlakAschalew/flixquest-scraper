import axios from 'axios'

const TMDB_BASE_URL = 'https://api.themoviedb.org/3'
const TMDB_API_KEY = process.env.TMDB_API_KEY || ''

if (!TMDB_API_KEY) {
  console.warn(
    '⚠️  TMDB_API_KEY not set in environment variables. TMDB features will not work.'
  )
}

export interface MovieMedia {
  type: 'movie'
  title: string
  releaseYear: number
  tmdbId: string
  imdbId?: string
}

export interface ShowMedia {
  type: 'show'
  title: string
  releaseYear: number
  tmdbId: string
  imdbId?: string
  episode: {
    number: number
    tmdbId: string
  }
  season: {
    number: number
    tmdbId: string
    title: string
    episodeCount?: number
  }
}

interface TMDBMovieResponse {
  id: number
  title: string
  release_date: string
  imdb_id?: string
}

interface TMDBShowResponse {
  id: number
  name: string
  first_air_date: string
  seasons: Array<{
    id: number
    season_number: number
    name: string
    episode_count: number
  }>
  external_ids?: { imdb_id?: string }
}

interface TMDBSeasonResponse {
  id: number
  name: string
  season_number: number
  episodes: Array<{
    id: number
    episode_number: number
    name: string
  }>
  episode_count?: number
}

/**
 * Fetch movie metadata from TMDB and generate MovieMedia object
 * @param tmdbId - The TMDB ID of the movie
 * @returns MovieMedia object ready for provider.runAll
 */
export async function generateMovieMedia(tmdbId: string): Promise<MovieMedia> {
  if (!TMDB_API_KEY) {
    throw new Error('TMDB_API_KEY is not configured')
  }

  try {
    const response = await axios.get<TMDBMovieResponse>(
      `${TMDB_BASE_URL}/movie/${tmdbId}`,
      {
        params: {
          api_key: TMDB_API_KEY,
        },
      }
    )

    const movie = response.data
    const releaseYear = new Date(movie.release_date).getFullYear()

    const media: MovieMedia = {
      type: 'movie',
      title: movie.title,
      releaseYear,
      tmdbId: tmdbId,
      ...(movie.imdb_id && { imdbId: movie.imdb_id }),
    }

    return media
  } catch (error) {
    if (axios.isAxiosError(error)) {
      throw new Error(
        `Failed to fetch movie from TMDB: ${
          error.response?.data?.status_message || error.message
        }`
      )
    }
    throw error
  }
}

/**
 * Fetch TV show metadata from TMDB and generate ShowMedia object
 * @param tmdbId - The TMDB ID of the TV show
 * @param seasonNumber - Season number
 * @param episodeNumber - Episode number
 * @returns ShowMedia object ready for provider.runAll
 */
export async function generateShowMedia(
  tmdbId: string,
  seasonNumber: number,
  episodeNumber: number
): Promise<ShowMedia> {
  if (!TMDB_API_KEY) {
    throw new Error('TMDB_API_KEY is not configured')
  }

  try {
    // Fetch TV show details
    const showResponse = await axios.get<TMDBShowResponse>(
      `${TMDB_BASE_URL}/tv/${tmdbId}`,
      {
        params: {
          api_key: TMDB_API_KEY,
          append_to_response: 'external_ids',
        },
      }
    )

    const show = showResponse.data
    const releaseYear = new Date(show.first_air_date).getFullYear()

    // Fetch season details to get episode TMDB ID
    const seasonResponse = await axios.get<TMDBSeasonResponse>(
      `${TMDB_BASE_URL}/tv/${tmdbId}/season/${seasonNumber}`,
      {
        params: {
          api_key: TMDB_API_KEY,
        },
      }
    )

    const season = seasonResponse.data
    const episode = season.episodes.find(
      ep => ep.episode_number === episodeNumber
    )

    if (!episode) {
      throw new Error(
        `Episode ${episodeNumber} not found in season ${seasonNumber}`
      )
    }

    const media: ShowMedia = {
      type: 'show',
      title: show.name,
      releaseYear,
      tmdbId: tmdbId,
      ...(show.external_ids?.imdb_id && { imdbId: show.external_ids.imdb_id }),
      episode: {
        number: episodeNumber,
        tmdbId: episode.id.toString(),
      },
      season: {
        number: seasonNumber,
        tmdbId: season.id.toString(),
        title: season.name,
        episodeCount: season.episode_count,
      },
    }

    return media
  } catch (error) {
    if (axios.isAxiosError(error)) {
      throw new Error(
        `Failed to fetch TV show from TMDB: ${
          error.response?.data?.status_message || error.message
        }`
      )
    }
    throw error
  }
}

/**
 * Search for movies on TMDB
 * @param query - Search query string
 * @param year - Optional release year to filter results
 * @returns Array of movie results with basic info
 */
export async function searchMovies(query: string, year?: number) {
  if (!TMDB_API_KEY) {
    throw new Error('TMDB_API_KEY is not configured')
  }

  try {
    const response = await axios.get(`${TMDB_BASE_URL}/search/movie`, {
      params: {
        api_key: TMDB_API_KEY,
        query,
        ...(year && { year }),
      },
    })

    return response.data.results.map(
      (movie: {
        id: number
        title: string
        release_date: string
        overview: string
      }) => ({
        id: movie.id,
        title: movie.title,
        releaseDate: movie.release_date,
        overview: movie.overview,
      })
    )
  } catch (error) {
    if (axios.isAxiosError(error)) {
      throw new Error(
        `Failed to search movies on TMDB: ${
          error.response?.data?.status_message || error.message
        }`
      )
    }
    throw error
  }
}

/**
 * Search for TV shows on TMDB
 * @param query - Search query string
 * @param year - Optional first air date year to filter results
 * @returns Array of TV show results with basic info
 */
export async function searchTVShows(query: string, year?: number) {
  if (!TMDB_API_KEY) {
    throw new Error('TMDB_API_KEY is not configured')
  }

  try {
    const response = await axios.get(`${TMDB_BASE_URL}/search/tv`, {
      params: {
        api_key: TMDB_API_KEY,
        query,
        ...(year && { first_air_date_year: year }),
      },
    })

    return response.data.results.map(
      (show: {
        id: number
        name: string
        first_air_date: string
        overview: string
      }) => ({
        id: show.id,
        name: show.name,
        firstAirDate: show.first_air_date,
        overview: show.overview,
      })
    )
  } catch (error) {
    if (axios.isAxiosError(error)) {
      throw new Error(
        `Failed to search TV shows on TMDB: ${
          error.response?.data?.status_message || error.message
        }`
      )
    }
    throw error
  }
}
