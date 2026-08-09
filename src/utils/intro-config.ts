export interface IntroConfig {
  enabled: boolean
  url: string | null
}

function parseEnabled(value: string | undefined): boolean | undefined {
  if (value === undefined || value.trim() === '') return undefined

  switch (value.trim().toLowerCase()) {
    case 'true':
    case '1':
    case 'yes':
    case 'on':
      return true
    case 'false':
    case '0':
    case 'no':
    case 'off':
      return false
    default:
      throw new Error('INTRO_VIDEO_ENABLED must be a boolean value')
  }
}

export function resolveIntroConfig(
  environment: NodeJS.ProcessEnv = process.env
): IntroConfig {
  const rawUrl = environment.INTRO_VIDEO_URL?.trim() || ''
  const enabled = parseEnabled(environment.INTRO_VIDEO_ENABLED) ?? !!rawUrl

  if (!enabled) return { enabled: false, url: null }
  if (!rawUrl) {
    throw new Error(
      'INTRO_VIDEO_URL must be configured when INTRO_VIDEO_ENABLED is true'
    )
  }

  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw new Error('INTRO_VIDEO_URL must be a valid absolute URL')
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('INTRO_VIDEO_URL must use HTTP or HTTPS')
  }

  return { enabled: true, url: url.href }
}
