import { Router } from 'express'

export interface BannerAd {
  key: string
  id: string
  name: string
  imageUrl: string
  targetUrl: string
  altText: string
  shape: 'square' | 'rectangle' | 'wide' | 'portrait'
  aspectRatio: number
  placements: readonly string[]
}

// Keep the first catalog in source control until an ad-management store is
// needed. The response shape is intentionally storage-independent.
const ADS: readonly BannerAd[] = [
  {
    key: 'banner_1',
    id: 'flixquest-community',
    name: 'Join the FlixQuest community',
    imageUrl:
      'https://placehold.co/1600x500/111827/f8fafc/png?text=Join+the+FlixQuest+community',
    targetUrl: 'https://t.me/flixquestapp',
    altText: 'Join the FlixQuest community',
    shape: 'wide',
    aspectRatio: 3.2,
    placements: [
      'home_movies',
      'home_tv',
      'movie_detail',
      'tv_detail',
      'season_detail',
      'episode_detail',
      'downloads',
      'bookmarks',
      'live_tv',
    ],
  },
  {
    key: 'banner_2',
    id: 'discover-more',
    name: 'Discover more stories',
    imageUrl:
      'https://placehold.co/1200x550/1e293b/f8fafc/png?text=Discover+more+stories',
    targetUrl: 'https://t.me/flixquestapp',
    altText: 'Discover more stories with FlixQuest',
    shape: 'rectangle',
    aspectRatio: 2.2,
    placements: [
      'home_movies',
      'home_tv',
      'movie_detail',
      'tv_detail',
      'season_detail',
      'episode_detail',
      'downloads',
      'bookmarks',
      'live_tv',
    ],
  },
]

export const adsRouter = Router()

/** GET /api/v2/ads */
adsRouter.get('/', (_req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=300')
  res.json({
    success: true,
    count: ADS.length,
    ads: ADS,
  })
})
