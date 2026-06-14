import { test, expect } from '@playwright/test'

const TEST_FILE = {
  name: 'secret.txt',
  mimeType: 'text/plain',
  // Distinctive content — if any byte of this reaches the server it will show up in frame inspection
  buffer: Buffer.from('CANARY_PAYLOAD_' + 'X'.repeat(512)),
}

test.describe('Zero-knowledge guarantees — nothing sensitive reaches the signaling server', () => {
  test('encryption key in share URL is only in the hash fragment, never in path or query', async ({ page }) => {
    await page.goto('/')
    await page.locator('input[type="file"]').setInputFiles(TEST_FILE)

    const linkBox = page.locator('.mono', { hasText: 'http://localhost' })
    await expect(linkBox).toBeVisible({ timeout: 10_000 })
    const shareUrl = await linkBox.innerText()

    const parsed = new URL(shareUrl)

    // Key must be in the fragment only
    expect(parsed.hash).toContain('key=')

    // Key must NOT appear anywhere the server can see
    expect(parsed.pathname).not.toContain('key=')
    expect(parsed.search).not.toContain('key=')

    // Fragment must be the only place the room ID appears (server gets it via socket event, not URL)
    expect(parsed.hash).toContain('room=')
    expect(parsed.search).not.toContain('room=')
  })

  test('URL hash fragment is never sent to the signaling server in any HTTP or WebSocket request', async ({ page }) => {
    // Capture every request URL the browser sends to port 3001 (the signaling server)
    const requestedUrls = []
    page.on('request', req => {
      if (req.url().includes('3001') || req.url().includes('/socket.io')) {
        requestedUrls.push(req.url())
      }
    })

    await page.goto('/')
    await page.locator('input[type="file"]').setInputFiles(TEST_FILE)

    const linkBox = page.locator('.mono', { hasText: 'http://localhost' })
    await expect(linkBox).toBeVisible({ timeout: 10_000 })
    const shareUrl = await linkBox.innerText()
    const key = new URL(shareUrl).hash.split('key=')[1]

    // Give the socket time to connect and emit join-room
    await page.waitForTimeout(2000)

    // The fragment (and therefore the key) must never appear in any request URL
    for (const url of requestedUrls) {
      // Fragments are stripped by browsers before sending — this is the browser guarantee we verify
      expect(url).not.toContain('#')
      if (key) expect(url).not.toContain(key.slice(0, 20)) // first 20 chars of key are distinctive enough
    }
  })

  test('signaling server WebSocket frames contain only JSON signaling — no file bytes, no key material', async ({ browser }) => {
    const senderCtx = await browser.newContext()
    const receiverCtx = await browser.newContext({ acceptDownloads: true })
    const senderPage = await senderCtx.newPage()
    const receiverPage = await receiverCtx.newPage()

    // Intercept all WebSocket frames on both pages
    const signalingFrames = []

    function captureWsFrames(page) {
      page.on('websocket', ws => {
        // Only care about frames going to the signaling server
        if (!ws.url().includes('/socket.io')) return
        ws.on('framesent', frame => signalingFrames.push({ dir: 'sent', data: frame.payload }))
        ws.on('framereceived', frame => signalingFrames.push({ dir: 'recv', data: frame.payload }))
      })
    }

    captureWsFrames(senderPage)
    captureWsFrames(receiverPage)

    await senderPage.goto('/')
    await senderPage.locator('input[type="file"]').setInputFiles(TEST_FILE)

    const linkBox = senderPage.locator('.mono', { hasText: 'http://localhost' })
    await expect(linkBox).toBeVisible({ timeout: 10_000 })
    const shareUrl = await linkBox.innerText()
    const key = new URL(shareUrl).hash.split('key=')[1]

    await receiverPage.goto(shareUrl)

    // Wait long enough for the full transfer to complete
    await expect(receiverPage.locator('.notice-success')).toBeVisible({ timeout: 45_000 })

    // Every frame sent to the signaling server must be parseable JSON (offer/answer/ICE/room events)
    // Binary frames or frames containing file bytes would fail this check
    const CANARY = 'CANARY_PAYLOAD_'
    const binaryFrames = []
    const keyLeaks = []
    const fileLeaks = []

    for (const frame of signalingFrames) {
      const payload = typeof frame.data === 'string' ? frame.data : null

      // Binary frames (ArrayBuffer) going to the signaling server = file data leak
      if (typeof frame.data !== 'string') {
        binaryFrames.push(frame)
        continue
      }

      // File content appearing in a signaling message = data leak
      if (payload.includes(CANARY)) fileLeaks.push(payload)

      // Key appearing in any signaling frame = key leak
      if (key && payload.includes(key.slice(0, 20))) keyLeaks.push(payload)
    }

    expect(binaryFrames, 'No binary frames should reach the signaling server').toHaveLength(0)
    expect(fileLeaks, 'File content must never appear in signaling frames').toHaveLength(0)
    expect(keyLeaks, 'Encryption key must never appear in signaling frames').toHaveLength(0)

    // The frames we do expect: join-room, offer, answer, ice-candidate (all small JSON)
    const textFrames = signalingFrames.filter(f => typeof f.data === 'string')
    expect(textFrames.length).toBeGreaterThan(0)

    // Every text frame must be well under 64KB (file chunks are 64KB+ when encrypted)
    for (const frame of textFrames) {
      expect(
        (frame.data).length,
        `Signaling frame too large — possible file data leak: ${frame.data.slice(0, 80)}`
      ).toBeLessThan(64 * 1024)
    }

    await senderCtx.close()
    await receiverCtx.close()
  })
})
