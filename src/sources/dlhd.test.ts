import assert from 'node:assert/strict'
import test from 'node:test'
import { parseDlhdChannels, parseDlhdEpg, parseDlhdM3u8Urls } from './dlhd.js'

test('parseDlhdChannels extracts IDs and names from the 24/7 grid', () => {
  const channels = parseDlhdChannels(`
    <div class="grid">
      <a class="card" href="/watch.php?id=51" data-first="A">
        <div class="card__title">ABC USA</div><div>ID: 51</div>
      </a>
      <a class="card" href="/watch.php?id=302" data-first="A">
        <div class="card__title">A&amp;E USA</div><div>ID: 302</div>
      </a>
    </div>
  `)

  assert.deepEqual(
    channels.map(channel => ({ id: channel.id, name: channel.name })),
    [
      { id: '51', name: 'ABC USA' },
      { id: '302', name: 'A&E USA' },
    ]
  )
})

test('parseDlhdEpg preserves day/category/event/channel nesting', () => {
  const days = parseDlhdEpg(`
    <div class="schedule__day">
      <div class="schedule__dayTitle">Saturday 08th Aug 2026 - Schedule Time UK GMT</div>
      <div class="schedule__category">
        <div class="schedule__catHeader"><div class="card__meta">PPV Events</div></div>
        <div class="schedule__categoryBody">
          <div class="schedule__event">
            <div class="schedule__eventHeader">
              <span class="schedule__time" data-time="16:00">16:00</span>
              <span class="schedule__eventTitle">APFC Indian Fight League</span>
            </div>
            <div class="schedule__channels">
              <a href="/watch.php?id=170" title="Event PPV">Event PPV</a>
            </div>
          </div>
        </div>
      </div>
    </div>
  `)

  assert.equal(days[0].date, '2026-08-08')
  assert.equal(days[0].categories[0].name, 'PPV Events')
  assert.equal(days[0].categories[0].events[0].startsAt, '2026-08-08T16:00:00Z')
  assert.deepEqual(days[0].categories[0].events[0].channels[0], {
    id: '170',
    name: 'Event PPV',
    watchUrl: 'https://dlhd.st/watch.php?id=170',
  })
})

test('parseDlhdM3u8Urls decodes the player base64 source', () => {
  const urls = parseDlhdM3u8Urls(
    `<script>
      new Clappr.Player({
        source: window.atob('aHR0cHM6Ly9zdHJlYW0uZXhhbXBsZS9zZWN1cmUvcHJlbWl1bTUxL2luZGV4Lm0zdTg=')
      })
    </script>`,
    'https://player.example/premiumtv/daddy3.php?id=51'
  )

  assert.deepEqual(urls, ['https://stream.example/secure/premium51/index.m3u8'])
})
