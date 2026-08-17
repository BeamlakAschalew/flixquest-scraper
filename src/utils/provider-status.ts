import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { getProviderStatus } from './redis.js'

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url))

export const providerStatusFile = path.resolve(
  process.env.PROVIDER_STATUS_FILE || 'data/provider-status.json'
)

/**
 * Resolves the candidate locations where the status file may live depending on
 * how the app is bundled. On Vercel serverless the working directory is
 * `/var/task`, but a project can also be deployed from the compiled `dist/`
 * output, so we search both repo-root and `dist/` locations.
 */
function candidateStatusFiles(): string[] {
  const candidates = new Set<string>()
  if (process.env.PROVIDER_STATUS_FILE) {
    candidates.add(path.resolve(process.env.PROVIDER_STATUS_FILE))
  }
  candidates.add(path.resolve(process.cwd(), 'data/provider-status.json'))
  candidates.add(path.resolve(MODULE_DIR, '../../data/provider-status.json'))
  candidates.add(path.resolve(process.cwd(), 'dist/data/provider-status.json'))
  candidates.add(
    path.resolve(MODULE_DIR, '../../dist/data/provider-status.json')
  )
  return [...candidates]
}

export async function readProviderStatus(): Promise<unknown> {
  const cached = await getProviderStatus()
  if (cached !== null) {
    return cached
  }
  for (const file of candidateStatusFiles()) {
    try {
      const contents = await fs.readFile(file, 'utf8')
      return JSON.parse(contents) as unknown
    } catch (error) {
      const err = error as NodeJS.ErrnoException
      if (err.code !== 'ENOENT') {
        throw error
      }
    }
  }
  return null
}
