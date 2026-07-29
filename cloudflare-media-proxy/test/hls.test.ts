import { describe, expect, it } from 'vitest'
import {
  rewriteHlsPlaylist,
  selectHlsVariant,
  setPreferredHlsAudio,
} from '../src/hls.js'

const MASTER = `#EXTM3U
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="Italian",LANGUAGE="ita",DEFAULT=YES,URI="audio/ita.m3u8"
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="English",LANGUAGE="eng",DEFAULT=NO,URI="audio/eng.m3u8"
#EXT-X-STREAM-INF:BANDWIDTH=1000,RESOLUTION=640x360,AUDIO="audio"
low/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=4000,RESOLUTION=1920x1080,AUDIO="audio"
high/index.m3u8`

describe('HLS helpers', () => {
  it('keeps the selected variant and rendition tags', () => {
    const result = selectHlsVariant(
      MASTER,
      'https://cdn.example/master.m3u8',
      'https://cdn.example/high/index.m3u8'
    )
    expect(result).toContain('high/index.m3u8')
    expect(result).not.toContain('low/index.m3u8')
    expect(result).toContain('#EXT-X-MEDIA:TYPE=AUDIO')
  })

  it('marks the preferred audio rendition', () => {
    const result = setPreferredHlsAudio(MASTER, 'eng')
    expect(result).toContain('NAME="English",LANGUAGE="eng",DEFAULT=YES,URI=')
    expect(result).toContain('NAME="Italian",LANGUAGE="ita",DEFAULT=NO,URI=')
  })

  it('rewrites plain and URI attribute references', async () => {
    const result = await rewriteHlsPlaylist(
      MASTER,
      'https://cdn.example/master.m3u8',
      async url => `https://proxy.example/media?url=${encodeURIComponent(url)}`
    )
    expect(result).toContain(
      encodeURIComponent('https://cdn.example/high/index.m3u8')
    )
    expect(result).toContain(
      encodeURIComponent('https://cdn.example/audio/eng.m3u8')
    )
  })
})
