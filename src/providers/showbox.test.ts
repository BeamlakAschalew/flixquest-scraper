import assert from 'node:assert/strict'
import test from 'node:test'
import axios from 'axios'

test('ShowBox full mode resolves every matching FebBox file', async () => {
  const originalApiKey = process.env.TMDB_API_KEY
  process.env.TMDB_API_KEY = 'test-key'
  const originalGet = axios.get
  const originalPost = axios.post
  const resolvedFiles: string[] = []
  const moduleUrl = './showbox.js?full-files'
  const { configureShowBoxCookies, showboxProvider } = (await import(
    moduleUrl
  )) as typeof import('./showbox.js')
  configureShowBoxCookies('test-cookie')

  axios.get = (async (
    url: string,
    config?: { params?: Record<string, unknown> }
  ) => {
    if (url.includes('api.themoviedb.org/3/movie/550')) {
      return {
        data: {
          id: 550,
          title: 'Fight Club',
          release_date: '1999-10-15',
        },
      }
    }
    if (url === 'https://www.showbox.media/search') {
      return {
        data: '<div class="flw-item"><a href="/movie/fight-club-1999" title="Fight Club"></a></div>',
      }
    }
    if (url === 'https://www.showbox.media/movie/fight-club-1999') {
      return {
        data: '/index/share_link; data: { id: "123", type: 1 }',
      }
    }
    if (url === 'https://www.showbox.media/index/share_link') {
      return {
        data: {
          code: 1,
          data: { link: 'https://www.febbox.com/share/test-share' },
        },
      }
    }
    if (url === 'https://www.febbox.com/file/file_share_list') {
      assert.equal(config?.params?.parent_id, 0)
      return {
        data: {
          code: 1,
          data: {
            file_list: [
              { fid: 1, file_name: 'Fight Club 720p.mkv', is_dir: 0 },
              { fid: 2, file_name: 'Fight Club 1080p.mkv', is_dir: 0 },
            ],
          },
        },
      }
    }
    if (url.startsWith('https://cdn.example/')) return { data: '' }
    throw new Error(`Unexpected GET: ${url}`)
  }) as typeof axios.get

  axios.post = (async (_url: string, body: string) => {
    const fid = new URLSearchParams(body).get('fid') || ''
    resolvedFiles.push(fid)
    return {
      data: `var sources = [{"file":"https://cdn.example/${fid}.m3u8","label":"1080p"}];`,
    }
  }) as typeof axios.post

  try {
    const defaultLinks = await showboxProvider.streamMovie('550')
    assert.deepEqual(resolvedFiles, ['2'])
    assert.equal(defaultLinks.length, 1)
    resolvedFiles.length = 0

    const links = await showboxProvider.streamMovie('550', { full: true })
    assert.deepEqual(resolvedFiles, ['2', '1'])
    assert.equal(links.length, 2)
  } finally {
    axios.get = originalGet
    axios.post = originalPost
    if (originalApiKey === undefined) delete process.env.TMDB_API_KEY
    else process.env.TMDB_API_KEY = originalApiKey
  }
})
