import { Router } from 'express'
import type { Request, Response } from 'express'
import {
  getDlhdChannels,
  getDlhdEpg,
  getDlhdStream,
  type DlhdEpgDay,
} from '../sources/dlhd.js'

export const dlhdRouter = Router()

function queryString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function bypassCache(req: Request): boolean {
  const value = (
    queryString(req.query.refresh) ||
    queryString(req.query.skipCache) ||
    ''
  ).toLowerCase()
  return value === 'true' || value === '1'
}

function includes(value: string, search: string | undefined): boolean {
  return !search || value.toLowerCase().includes(search.toLowerCase())
}

dlhdRouter.get('/channels', async (req: Request, res: Response) => {
  try {
    const search = queryString(req.query.search) || queryString(req.query.q)
    const channels = (await getDlhdChannels(bypassCache(req))).filter(
      channel =>
        !channel.name.trim().toLowerCase().includes('+18') &&
        includes(`${channel.name} ${channel.id}`, search)
    )

    res.json({
      success: true,
      source: 'dlhd',
      count: channels.length,
      channels,
    })
  } catch (error) {
    res.status(502).json({
      success: false,
      error: 'Failed to fetch DLHD channels',
      details: error instanceof Error ? error.message : 'Unknown error',
    })
  }
})

async function streamHandler(req: Request, res: Response): Promise<void> {
  const channelId = req.params.id?.trim()
  if (!channelId || !/^\d+$/.test(channelId)) {
    res.status(400).json({
      success: false,
      error: 'Missing or invalid numeric DLHD channel ID',
    })
    return
  }

  try {
    const [stream, channels] = await Promise.all([
      getDlhdStream(channelId),
      getDlhdChannels().catch(() => []),
    ])
    const channel = channels.find(item => item.id === channelId) || {
      id: channelId,
      name: `DLHD Channel ${channelId}`,
    }

    res.setHeader('Cache-Control', 'no-store')
    res.json({
      success: true,
      source: 'dlhd',
      channel,
      stream,
      extractedAt: new Date().toISOString(),
    })
  } catch (error) {
    res.status(502).json({
      success: false,
      error: `Failed to extract DLHD stream for channel ${channelId}`,
      details: error instanceof Error ? error.message : 'Unknown error',
    })
  }
}

dlhdRouter.get('/channels/:id/stream', streamHandler)
dlhdRouter.get('/stream/:id', streamHandler)

function filterEpg(
  days: DlhdEpgDay[],
  date: string | undefined,
  category: string | undefined,
  search: string | undefined
): DlhdEpgDay[] {
  return days
    .filter(day => !date || day.date === date)
    .map(day => ({
      ...day,
      categories: day.categories
        .filter(item => includes(`${item.name} ${item.slug}`, category))
        .map(item => ({
          ...item,
          events: item.events.filter(event =>
            includes(
              `${event.title} ${event.time} ${event.channels.map(channel => channel.name).join(' ')}`,
              search
            )
          ),
        }))
        .filter(item => item.events.length > 0),
    }))
    .filter(day => day.categories.length > 0)
}

dlhdRouter.get('/epg', async (req: Request, res: Response) => {
  const date = queryString(req.query.date)
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    res.status(400).json({
      success: false,
      error: 'Invalid date; expected YYYY-MM-DD',
    })
    return
  }

  try {
    const category = queryString(req.query.category)
    const search = queryString(req.query.search) || queryString(req.query.q)
    const days = filterEpg(
      await getDlhdEpg(bypassCache(req)),
      date,
      category,
      search
    )
    const eventCount = days.reduce(
      (dayTotal, day) =>
        dayTotal +
        day.categories.reduce(
          (categoryTotal, item) => categoryTotal + item.events.length,
          0
        ),
      0
    )

    res.json({
      success: true,
      source: 'dlhd',
      timezone: 'UK GMT',
      filters: { date, category, search },
      dayCount: days.length,
      eventCount,
      days,
    })
  } catch (error) {
    res.status(502).json({
      success: false,
      error: 'Failed to fetch DLHD EPG',
      details: error instanceof Error ? error.message : 'Unknown error',
    })
  }
})
