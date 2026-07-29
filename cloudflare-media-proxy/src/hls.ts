export interface HlsRewriteOptions {
  selectedVariant?: string
  preferredAudioLanguage?: string
}

export function selectHlsVariant(
  text: string,
  upstreamUrl: string,
  selectedVariant: string
): string {
  const lines = text.split(/\r?\n/)
  const selectedUrl = new URL(selectedVariant, upstreamUrl).href
  const output: string[] = []
  let matched = false

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]
    if (!line.startsWith('#EXT-X-STREAM-INF:')) {
      output.push(line)
      continue
    }

    let uriIndex = index + 1
    while (
      uriIndex < lines.length &&
      (!lines[uriIndex].trim() || lines[uriIndex].startsWith('#'))
    ) {
      uriIndex++
    }

    if (uriIndex >= lines.length) {
      output.push(line)
      continue
    }

    const variantUrl = new URL(lines[uriIndex].trim(), upstreamUrl).href
    if (variantUrl === selectedUrl) {
      output.push(...lines.slice(index, uriIndex + 1))
      matched = true
    }
    index = uriIndex
  }

  if (!matched) {
    throw new Error('Requested HLS variant is no longer available')
  }
  return output.join('\n')
}

function setHlsAttribute(
  line: string,
  attribute: string,
  value: string
): string {
  const pattern = new RegExp(`(${attribute}=)(?:"[^"]*"|[^,]*)`)
  return pattern.test(line)
    ? line.replace(pattern, `$1${value}`)
    : `${line},${attribute}=${value}`
}

export function setPreferredHlsAudio(
  text: string,
  preferredAudioLanguage: string
): string {
  const lines = text.split(/\r?\n/)
  const preferred = preferredAudioLanguage.toLowerCase()
  const preferredIndex = lines.findIndex(line => {
    if (!line.startsWith('#EXT-X-MEDIA:TYPE=AUDIO')) return false
    const language = line.match(/(?:^|,)LANGUAGE="([^"]+)"/)?.[1]
    const name = line.match(/(?:^|,)NAME="([^"]+)"/)?.[1]
    return (
      language?.toLowerCase() === preferred ||
      language?.toLowerCase().split('-')[0] === preferred.split('-')[0] ||
      (preferred === 'eng' && name?.toLowerCase().includes('english'))
    )
  })

  if (preferredIndex < 0) return text
  return lines
    .map((line, index) => {
      if (!line.startsWith('#EXT-X-MEDIA:TYPE=AUDIO')) return line
      const isPreferred = index === preferredIndex
      return setHlsAttribute(
        setHlsAttribute(line, 'DEFAULT', isPreferred ? 'YES' : 'NO'),
        'AUTOSELECT',
        isPreferred ? 'YES' : 'NO'
      )
    })
    .join('\n')
}

export async function rewriteHlsPlaylist(
  text: string,
  upstreamUrl: string,
  proxyUri: (absoluteUrl: string) => Promise<string>,
  options: HlsRewriteOptions = {}
): Promise<string> {
  let selected = options.selectedVariant
    ? selectHlsVariant(text, upstreamUrl, options.selectedVariant)
    : text
  if (options.preferredAudioLanguage) {
    selected = setPreferredHlsAudio(selected, options.preferredAudioLanguage)
  }

  return (
    await Promise.all(
      selected.split(/\r?\n/).map(async line => {
        if (line && !line.startsWith('#')) {
          try {
            return await proxyUri(new URL(line.trim(), upstreamUrl).href)
          } catch {
            return line
          }
        }

        const matches = Array.from(line.matchAll(/URI="([^"]+)"/g))
        if (matches.length === 0) return line

        let rewritten = line
        for (const match of matches) {
          try {
            const absolute = new URL(match[1], upstreamUrl).href
            const proxied = await proxyUri(absolute)
            rewritten = rewritten.replace(match[0], `URI="${proxied}"`)
          } catch {
            // Preserve malformed optional tags instead of breaking playback.
          }
        }
        return rewritten
      })
    )
  ).join('\n')
}
