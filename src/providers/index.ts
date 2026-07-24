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

// API routes choose the final direct/proxied URL before validation. Other
// consumers keep using getProvider() for direct upstream validation.
export function getRawProvider(providerId: string): Provider | undefined {
  return rawProviders[providerId]
}

// Get all provider IDs
export function getAllProviderIds(): string[] {
  return Object.keys(providers)
}

// Get all providers
export function getAllProviders(): Provider[] {
  return Object.values(providers)
}
