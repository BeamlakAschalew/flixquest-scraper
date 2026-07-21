import type { Provider } from '../types/index.js'
import { vixsrcProvider } from './vixsrc.js'
import { vidsrcProvider } from './vidsrc.js'
import { vidzeeProvider } from './vidzee.js'
import { uhdmoviesProvider } from './uhdmovies.js'
import { showboxProvider } from './showbox.js'
import { fourKHDHubNewProvider, fourKHDHubProvider } from './fourkhdhub.js'
import { dahmerMoviesProvider } from './dahmermovies.js'
import { dahmerMoviesTvProvider } from './dahmermovies-tv.js'
import { noTorrentProvider } from './notorrent.js'
import { streamFlixProvider } from './streamflix.js'
import { vidEasyProvider } from './videasy.js'
import { withStreamValidation } from '../utils/stream-validation.js'

// Register all providers here
const rawProviders: Record<string, Provider> = {
  vixsrc: vixsrcProvider,
  vidsrc: vidsrcProvider,
  vidzee: vidzeeProvider,
  uhdmovies: uhdmoviesProvider,
  showbox: showboxProvider,
  '4khdhub': fourKHDHubProvider,
  '4khdhubnew': fourKHDHubNewProvider,
  dahmermovies: dahmerMoviesProvider,
  'dahmermovies-tv': dahmerMoviesTvProvider,
  streamflix: streamFlixProvider,
  videasy: vidEasyProvider,
  notorrent: noTorrentProvider,
}

// Every public provider result is checked with a one-byte ranged request. This
// removes expired/forbidden URLs and HTML landing pages before they reach users.
export const providers: Record<string, Provider> = Object.fromEntries(
  Object.entries(rawProviders).map(([id, provider]) => [
    id,
    withStreamValidation(provider),
  ])
)

// Get a provider by ID
export function getProvider(providerId: string): Provider | undefined {
  return providers[providerId]
}

// Get all provider IDs
export function getAllProviderIds(): string[] {
  return Object.keys(providers)
}

// Get all providers
export function getAllProviders(): Provider[] {
  return Object.values(providers)
}
