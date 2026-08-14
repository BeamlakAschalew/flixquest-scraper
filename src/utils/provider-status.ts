import fs from 'node:fs/promises'
import path from 'node:path'

export const providerStatusFile = path.resolve(
  process.env.PROVIDER_STATUS_FILE || 'data/provider-status.json'
)

export async function readProviderStatus(): Promise<unknown> {
  const contents = await fs.readFile(providerStatusFile, 'utf8')
  return JSON.parse(contents) as unknown
}
