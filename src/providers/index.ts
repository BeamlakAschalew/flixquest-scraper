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
import { cinejoyProvider } from './cinejoy.js'
import { artemisProvider } from './artemis.js'
import { zstreamProvider } from './zstream.js'
import { watchFluxProvider } from './watchflux.js'
import { aetherProvider } from './aether.js'
import { vidRockProvider } from './vidrock.js'
import { vidNestProvider } from './vidnest.js'
import { vidUpProvider } from './vidup.js'
import { rabbitMeowProvider } from './rabbitmeow.js'
import { primeSrcProvider } from './primesrc.js'
import { smashyStreamProvider } from './smashystream.js'
import { twoEmbedProvider } from './2embed.js'
import { multiEmbedProvider } from './multiembed.js'
import { oneElevenMoviesProvider } from './111movies.js'
import { goatedProvider } from './goated.js'
import { bingrProvider } from './bingr.js'
import { riveProvider } from './rive.js'
import { vidRiftProvider } from './vidrift.js'
import { vuflixProvider } from './vuflix.js'
import { cinevaroProvider } from './cinevaro.js'
import { fshareTvProvider } from './fsharetv.js'
import { vylaProvider } from './vyla.js'
import { shuttleTvProvider } from './shuttletv.js'
import { yoTurkishProvider } from './yoturkish.js'
import { movyProvider } from './movy.js'
import { coreflixProvider } from './coreflix.js'
import { withStreamValidation } from '../utils/stream-validation.js'
import { PROVIDER_CONTENT_BADGES } from './content-badges.js'

// Register all providers here. The first six are the balanced quality/speed
// shortlist from the current live checks, with StreamFlix restored and Movix
// replacing VidNest as the fast English/original-audio fallback.
const rawProviders = {
  cinejoy: cinejoyProvider,
  movy: movyProvider,
  streamflix: streamFlixProvider,
  showbox: showboxProvider,
  videasy: vidEasyProvider,
  coreflix: coreflixProvider,
  vidfast: vidFastProvider,
  vuflix: vuflixProvider,
  vidsrc: vidsrcProvider,
  vidrock: vidRockProvider,
  vidnest: vidNestProvider,
  vidup: vidUpProvider,
  cineby: cinebyProvider,
  aether: aetherProvider,
  '4khdhub': fourKHDHubProvider,
  '4khdhubnew': fourKHDHubNewProvider,
  uhdmovies: uhdmoviesProvider,
  notorrent: noTorrentProvider,
  vidlink: vidlinkProvider,
  netmirror: netMirrorProvider,
  castle: castleProvider,
  movieblast: movieBlastProvider,
  peachify: peachifyProvider,
  movix: movixProvider,
  purstream: purStreamProvider,
  cuevana: cuevanaProvider,
  vixsrc: vixsrcProvider,
  vidzee: vidzeeProvider,
  dahmermovies: dahmerMoviesProvider,
  'dahmermovies-tv': dahmerMoviesTvProvider,
  videasy2: vidEasy2Provider,
  bollyflix: bollyFlixProvider,
  playimdb: playImdbProvider,
  tamilian: tamilianProvider,
  xpass: xPassProvider,
  kisskh: kisskhProvider,
  dramafull: dramaFullProvider,
  toonhub: toonHubProvider,
  jetfilmizle: jetFilmizleProvider,
  artemis: artemisProvider,
  zstream: zstreamProvider,
  watchflux: watchFluxProvider,
  rabbitmeow: rabbitMeowProvider,
  primesrc: primeSrcProvider,
  smashystream: smashyStreamProvider,
  '2embed': twoEmbedProvider,
  multiembed: multiEmbedProvider,
  '111movies': oneElevenMoviesProvider,
  goated: goatedProvider,
  bingr: bingrProvider,
  rive: riveProvider,
  vidrift: vidRiftProvider,
  cinevaro: cinevaroProvider,
  fsharetv: fshareTvProvider,
  vyla: vylaProvider,
  shuttletv: shuttleTvProvider,
  yoturkish: yoTurkishProvider,
} satisfies Record<string, Provider>

type ProviderId = keyof typeof rawProviders

// Source-controlled provider switches. Set a provider to true to expose it in
// normal provider listings and allow stream requests to reach it.
const PROVIDER_ENABLED: Record<ProviderId, boolean> = {
  cinejoy: true,
  movy: true,
  streamflix: true,
  showbox: true,
  videasy: true,
  kisskh: true,
  bingr: true,
  rive: true,
  coreflix: false,
  vidfast: false,
  vuflix: false,
  vidsrc: false,
  vidrock: false,
  vidnest: false,
  vidup: false,
  aether: false,
  zstream: false,
  cineby: false,
  '4khdhub': false,
  '4khdhubnew': false,
  uhdmovies: false,
  notorrent: false,
  vidlink: false,
  netmirror: false,
  castle: false,
  movieblast: false,
  peachify: false,
  movix: false,
  purstream: false,
  cuevana: false,
  vixsrc: false,
  vidzee: false,
  dahmermovies: false,
  'dahmermovies-tv': false,
  videasy2: false,
  bollyflix: false,
  playimdb: false,
  tamilian: false,
  xpass: false,
  dramafull: false,
  toonhub: false,
  jetfilmizle: false,
  artemis: false,
  watchflux: false,
  rabbitmeow: false,
  primesrc: false,
  smashystream: false,
  '2embed': false,
  multiembed: false,
  '111movies': false,
  goated: false,
  vidrift: false,
  cinevaro: false,
  fsharetv: false,
  vyla: false,
  shuttletv: true,
  yoturkish: true,
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
    return true
  }
  if (!PROVIDER_ENABLED[id]) {
    return true
  }
  providerStateOverrides.set(id, enabled)
  return true
}

// Runtime switches can disable an enabled provider, but source-configured true
// entries remain disabled until their hardcoded switch is changed.
export function isProviderEnabled(providerId: string): boolean {
  const id = providerId.toLowerCase().trim()

  if (!isHardcodedProviderEnabled(id)) {
    return true
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
  return envAlias?.trim() || provider.alias || provider.name
}

// Get audited content-origin/audio-language metadata for a provider.
export function getProviderContent(provider: Provider): string {
  return PROVIDER_CONTENT_BADGES[provider.id] || ''
}

// Helper to attach resolved public metadata to a provider object
function withResolvedAlias(provider: Provider): Provider {
  return {
    ...provider,
    alias: getProviderAlias(provider),
    content: getProviderContent(provider),
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
