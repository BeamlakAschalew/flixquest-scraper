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
import { vidEasy2Provider } from './videasy2.js'
import { bollyFlixProvider } from './bollyflix.js'
import { playImdbProvider } from './playimdb.js'
import { vidlinkProvider } from './vidlink.js'
import { netMirrorProvider } from './netmirror.js'
import { tamilianProvider } from './tamilian.js'
import { vidFastProvider } from './vidfast.js'
import { castleProvider } from './castle.js'
import { movieBlastProvider } from './movieblast.js'
import { peachifyProvider } from './peachify.js'
import { movixProvider } from './movix.js'
import { purStreamProvider } from './purstream.js'
import { xPassProvider } from './xpass.js'
import { kisskhProvider } from './kisskh.js'
import { dramaFullProvider } from './dramafull.js'
import { toonHubProvider } from './toonhub.js'
import { cuevanaProvider } from './cuevana.js'
import { jetFilmizleProvider } from './jetfilmizle.js'
import { cinebyProvider } from './cineby.js'
import { artemisProvider } from './artemis.js'
import { watchFluxProvider } from './watchflux.js'
import { aetherProvider } from './aether.js'
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
  videasy2: vidEasy2Provider,
  notorrent: noTorrentProvider,
  bollyflix: bollyFlixProvider,
  playimdb: playImdbProvider,
  vidlink: vidlinkProvider,
  netmirror: netMirrorProvider,
  tamilian: tamilianProvider,
  vidfast: vidFastProvider,
  castle: castleProvider,
  movieblast: movieBlastProvider,
  peachify: peachifyProvider,
  movix: movixProvider,
  purstream: purStreamProvider,
  xpass: xPassProvider,
  kisskh: kisskhProvider,
  dramafull: dramaFullProvider,
  toonhub: toonHubProvider,
  cuevana: cuevanaProvider,
  jetfilmizle: jetFilmizleProvider,
  cineby: cinebyProvider,
  artemis: artemisProvider,
  watchflux: watchFluxProvider,
  aether: aetherProvider,
}

// In-memory store for dynamic runtime provider toggle overrides
const providerStateOverrides = new Map<string, boolean>()

// Dynamically set provider enabled state at runtime
export function setProviderEnabled(
  providerId: string,
  enabled: boolean
): boolean {
  const id = providerId.toLowerCase().trim()
  if (!rawProviders[id]) {
    return false
  }
  providerStateOverrides.set(id, enabled)
  return true
}

// Check if a provider is enabled based on runtime state overrides
export function isProviderEnabled(providerId: string): boolean {
  const id = providerId.toLowerCase().trim()

  if (providerStateOverrides.has(id)) {
    return providerStateOverrides.get(id)!
  }

  return true
}

// Get resolved provider alias (environment variable override -> provider.alias -> provider.name)
export function getProviderAlias(provider: Provider): string {
  const envVarKey = provider.id.replace(/[^a-zA-Z0-9]/g, '_').toUpperCase()
  const envAlias = process.env[`PROVIDER_ALIAS_${envVarKey}`]
  if (envAlias && envAlias.trim()) {
    return envAlias.trim()
  }
  return provider.alias || provider.name
}

// Helper to attach resolved alias to a provider object
function withResolvedAlias(provider: Provider): Provider {
  return {
    ...provider,
    alias: getProviderAlias(provider),
  }
}

// Every public provider result is checked with a one-byte ranged request. This
// removes expired/forbidden URLs and HTML landing pages before they reach users.
export const providers: Record<string, Provider> = Object.fromEntries(
  Object.entries(rawProviders).map(([id, provider]) => [
    id,
    withStreamValidation(provider),
  ])
)

// Options for querying providers
export interface ProviderQueryOptions {
  includeDisabled?: boolean
}

// Get a provider by ID
export function getProvider(
  providerId: string,
  options?: ProviderQueryOptions
): Provider | undefined {
  if (!options?.includeDisabled && !isProviderEnabled(providerId)) {
    return undefined
  }
  const provider = providers[providerId]
  return provider ? withResolvedAlias(provider) : undefined
}

// API routes choose the final direct/proxied URL before validation. Other
// consumers keep using getProvider() for direct upstream validation.
export function getRawProvider(
  providerId: string,
  options?: ProviderQueryOptions
): Provider | undefined {
  if (!options?.includeDisabled && !isProviderEnabled(providerId)) {
    return undefined
  }
  const provider = rawProviders[providerId]
  return provider ? withResolvedAlias(provider) : undefined
}

// Get all provider IDs
export function getAllProviderIds(options?: ProviderQueryOptions): string[] {
  return Object.keys(providers).filter(
    id => options?.includeDisabled || isProviderEnabled(id)
  )
}

// Get all providers
export function getAllProviders(options?: ProviderQueryOptions): Provider[] {
  return Object.entries(providers)
    .filter(([id]) => options?.includeDisabled || isProviderEnabled(id))
    .map(([, provider]) => withResolvedAlias(provider))
}
