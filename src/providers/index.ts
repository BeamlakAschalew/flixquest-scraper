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
const rawProviders = {
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
} satisfies Record<string, Provider>

type ProviderId = keyof typeof rawProviders

// Source-controlled provider switches. Set a provider to false to remove it
// from normal provider listings and prevent stream requests from reaching it.
const PROVIDER_ENABLED: Record<ProviderId, boolean> = {
  vixsrc: false,
  vidsrc: false,
  vidzee: false,
  uhdmovies: true,
  showbox: true,
  '4khdhub': true,
  '4khdhubnew': true,
  dahmermovies: false,
  'dahmermovies-tv': false,
  streamflix: true,
  videasy: true,
  videasy2: false,
  notorrent: true,
  bollyflix: false,
  playimdb: false,
  vidlink: true,
  netmirror: true,
  tamilian: false,
  vidfast: true,
  castle: true,
  movieblast: true,
  peachify: true,
  movix: true,
  purstream: true,
  xpass: false,
  kisskh: false,
  dramafull: false,
  toonhub: false,
  cuevana: true,
  jetfilmizle: false,
  cineby: true,
  artemis: false,
  watchflux: false,
  aether: true,
}

function isProviderId(id: string): id is ProviderId {
  return id in rawProviders
}

function isHardcodedProviderEnabled(providerId: string): boolean {
  return isProviderId(providerId) && PROVIDER_ENABLED[providerId]
}

// In-memory store for dynamic runtime provider toggle overrides
const providerStateOverrides = new Map<string, boolean>()

// Dynamically set provider enabled state at runtime
export function setProviderEnabled(
  providerId: string,
  enabled: boolean
): boolean {
  const id = providerId.toLowerCase().trim()
  if (!isProviderId(id)) {
    return false
  }
  if (!PROVIDER_ENABLED[id]) {
    return false
  }
  providerStateOverrides.set(id, enabled)
  return true
}

// Runtime switches can disable an enabled provider, but source-configured false
// entries remain disabled until their hardcoded switch is changed.
export function isProviderEnabled(providerId: string): boolean {
  const id = providerId.toLowerCase().trim()

  if (!isHardcodedProviderEnabled(id)) {
    return false
  }

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
  if (!isHardcodedProviderEnabled(providerId.toLowerCase().trim())) {
    return undefined
  }
  if (!options?.includeDisabled && !isProviderEnabled(providerId)) {
    return undefined
  }
  const provider = providers[providerId.toLowerCase().trim()]
  return provider ? withResolvedAlias(provider) : undefined
}

// API routes choose the final direct/proxied URL before validation. Other
// consumers keep using getProvider() for direct upstream validation.
export function getRawProvider(
  providerId: string,
  options?: ProviderQueryOptions
): Provider | undefined {
  if (!isHardcodedProviderEnabled(providerId.toLowerCase().trim())) {
    return undefined
  }
  if (!options?.includeDisabled && !isProviderEnabled(providerId)) {
    return undefined
  }
  const id = providerId.toLowerCase().trim()
  if (!isProviderId(id)) {
    return undefined
  }
  const provider = rawProviders[id]
  return provider ? withResolvedAlias(provider) : undefined
}

// Get all provider IDs
export function getAllProviderIds(options?: ProviderQueryOptions): string[] {
  return Object.keys(providers).filter(
    id =>
      isHardcodedProviderEnabled(id) &&
      (options?.includeDisabled || isProviderEnabled(id))
  )
}

// Get all providers
export function getAllProviders(options?: ProviderQueryOptions): Provider[] {
  return Object.entries(providers)
    .filter(
      ([id]) =>
        isHardcodedProviderEnabled(id) &&
        (options?.includeDisabled || isProviderEnabled(id))
    )
    .map(([, provider]) => withResolvedAlias(provider))
}
