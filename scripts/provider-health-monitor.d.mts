export interface ProviderHealthCheckOptions {
  baseUrl?: string
  outputFile?: string
  concurrency?: number
  timeoutMs?: number
  matrixMode?: string
}

export interface ProviderHealthResult {
  provider: string
  alias: string
  status: 'online' | 'offline'
  requestTimeMs: number
  checkedAt: string
  [key: string]: unknown
}

export interface ProviderHealthStatus {
  success: boolean
  startedAt: string
  updatedAt: string
  intervalMs: number
  methodology: string
  summary: { total: number; online: number; offline: number }
  providers: ProviderHealthResult[]
}

export function runProviderHealthCheck(
  options?: ProviderHealthCheckOptions
): Promise<ProviderHealthStatus>

export function startProviderHealthMonitor(
  options?: ProviderHealthCheckOptions
): Promise<() => void>
