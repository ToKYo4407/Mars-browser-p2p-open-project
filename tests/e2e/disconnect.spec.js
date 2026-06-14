import { test, expect } from '@playwright/test'

const SMALL_FILE = {
  name: 'ping.txt',
  mimeType: 'text/plain',
  buffer: Buffer.from('ping'),
}

test.describe('Graceful disconnect handling', () => {
  test('sender sees disconnect notice when receiver closes tab', async ({ browser }) => {
    const senderCtx = await browser.newContext()
    const receiverCtx = await browser.newContext({ acceptDownloads: true })
    const senderPage = await senderCtx.newPage()
    const receiverPage = await receiverCtx.newPage()

    await senderPage.goto('/')
    await senderPage.locator('input[type="file"]').setInputFiles(SMALL_FILE)

    const linkBox = senderPage.locator('.mono', { hasText: 'http://localhost' })
    await expect(linkBox).toBeVisible({ timeout: 10_000 })
    const shareUrl = await linkBox.innerText()

    await receiverPage.goto(shareUrl)

    // Wait until both sides are connected
    await expect(senderPage.locator('.status-dot.connected')).toBeVisible({ timeout: 20_000 })

    // Receiver closes their tab mid-transfer
    await receiverPage.close()

    // Sender must show a disconnect error notice, not a crash
    await expect(senderPage.locator('.notice-error')).toBeVisible({ timeout: 10_000 })
    await expect(senderPage.locator('text=Receiver disconnected')).toBeVisible()

    await senderCtx.close()
  })

  test('receiver sees disconnect notice when sender closes tab', async ({ browser }) => {
    const senderCtx = await browser.newContext()
    const receiverCtx = await browser.newContext({ acceptDownloads: true })
    const senderPage = await senderCtx.newPage()
    const receiverPage = await receiverCtx.newPage()

    await senderPage.goto('/')
    await senderPage.locator('input[type="file"]').setInputFiles(SMALL_FILE)

    const linkBox = senderPage.locator('.mono', { hasText: 'http://localhost' })
    await expect(linkBox).toBeVisible({ timeout: 10_000 })
    const shareUrl = await linkBox.innerText()

    await receiverPage.goto(shareUrl)
    await expect(senderPage.locator('.status-dot.connected')).toBeVisible({ timeout: 20_000 })

    await senderPage.close()

    await expect(receiverPage.locator('.notice-error')).toBeVisible({ timeout: 10_000 })
    await expect(receiverPage.locator('text=Sender disconnected')).toBeVisible()

    await receiverCtx.close()
  })

  test('"Send another file" button resets sender state', async ({ page }) => {
    await page.goto('/')
    await page.locator('input[type="file"]').setInputFiles(SMALL_FILE)
    await expect(page.locator('text=Share Link')).toBeVisible({ timeout: 10_000 })

    await page.locator('text=← Send another file').click()

    // Should be back to the drop zone
    await expect(page.locator('.drop-zone')).toBeVisible()
    await expect(page.locator('text=Share Link')).not.toBeVisible()
  })
})
