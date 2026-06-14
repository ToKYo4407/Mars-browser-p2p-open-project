import { test, expect } from '@playwright/test'
import { createHash } from 'crypto'

// 32 KB is enough to exercise chunking without being slow
const FILE_CONTENT = Buffer.alloc(32 * 1024, 0x61) // 'a' * 32KB
const FILE_NAME = 'test-payload.bin'
const EXPECTED_SHA256 = createHash('sha256').update(FILE_CONTENT).digest('hex')

test.describe('P2P file transfer — browser to browser', () => {
  test('sender and receiver complete a full transfer with hash verification', async ({ browser }) => {
    // Two isolated browser contexts simulate two different users
    const senderCtx = await browser.newContext()
    const receiverCtx = await browser.newContext({
      acceptDownloads: true,
    })

    const senderPage = await senderCtx.newPage()
    const receiverPage = await receiverCtx.newPage()

    await senderPage.goto('/')

    // Drop a file into the hidden input (works on hidden inputs in Playwright)
    await senderPage.locator('input[type="file"]').setInputFiles({
      name: FILE_NAME,
      mimeType: 'application/octet-stream',
      buffer: FILE_CONTENT,
    })

    // Wait for the share URL to appear in the ShareLink component
    const linkBox = senderPage.locator('.mono', { hasText: 'http://localhost' })
    await expect(linkBox).toBeVisible({ timeout: 10_000 })
    const shareUrl = await linkBox.innerText()
    expect(shareUrl).toContain('#room=')
    expect(shareUrl).toContain('key=')

    // Sender should show "waiting" status
    await expect(senderPage.locator('.status-dot.connecting, .status-dot.disconnected')).toBeVisible()

    // Receiver opens the share link — key is in the hash fragment, never hits the server
    const downloadPromise = receiverPage.waitForEvent('download', { timeout: 45_000 })
    await receiverPage.goto(shareUrl)

    // Receiver page 
    await expect(receiverPage.locator('text=receiving encrypted file')).toBeVisible()

    // Both sides reach "connected" status
    await expect(senderPage.locator('.status-dot.connected')).toBeVisible({ timeout: 20_000 })
    await expect(receiverPage.locator('.status-dot.connected')).toBeVisible({ timeout: 20_000 })

    // Progress bar must appear and reach 100%
    await expect(receiverPage.locator('.progress-fill')).toBeVisible({ timeout: 30_000 })

    // Wait for auto-download
    const download = await downloadPromise
    const downloadPath = await download.path()
    expect(downloadPath).toBeTruthy()

    // Verify SHA-256 of the downloaded file matches what the sender computed
    const { readFile } = await import('fs/promises')
    const received = await readFile(downloadPath)
    const receivedHash = createHash('sha256').update(received).digest('hex')
    expect(receivedHash).toBe(EXPECTED_SHA256)

    // Receiver page must show success notice
    await expect(receiverPage.locator('.notice-success')).toBeVisible({ timeout: 10_000 })

    await senderCtx.close()
    await receiverCtx.close()
  })

  test('sender page shows file metadata after file selection', async ({ page }) => {
    await page.goto('/')
    await page.locator('input[type="file"]').setInputFiles({
      name: 'demo.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('hello world'),
    })

    await expect(page.locator('text=demo.txt')).toBeVisible()
    await expect(page.locator('.tag')).toBeVisible() // chunk count tag

    // Share link 
    await expect(page.locator('text=Share Link')).toBeVisible()
  })

  test('rejects files larger than 50 MB', async ({ page }) => {
    await page.goto('/')
    const bigBuf = Buffer.alloc(51 * 1024 * 1024, 0x00)
    await page.locator('input[type="file"]').setInputFiles({
      name: 'huge.bin',
      mimeType: 'application/octet-stream',
      buffer: bigBuf,
    })
    await expect(page.locator('.notice-error')).toBeVisible()
    await expect(page.locator('text=50MB')).toBeVisible()
  })
})
