import type { Provider } from '../types/index.js'
import { vixsrcProvider } from './vixsrc.js'
import { vidsrcProvider } from './vidsrc.js'
import { vidzeeProvider } from './vidzee.js'
import { uhdmoviesProvider } from './uhdmovies.js'
import { showboxProvider } from './showbox.js'
import { fourKHDHubProvider } from './fourkhdhub.js'

// Register all providers here
export const providers: Record<string, Provider> = {
  vixsrc: vixsrcProvider,
  vidsrc: vidsrcProvider,
  vidzee: vidzeeProvider,
  uhdmovies: uhdmoviesProvider,
  showbox: showboxProvider,
  '4khdhub': fourKHDHubProvider,
}

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
