import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  retries: 1,
  use: {
    baseURL: 'http://localhost:4173',
    // grant clipboard + download permissions
    permissions: ['clipboard-read', 'clipboard-write'],
  },
  webServer: [
    {
      // signaling server must be up before browser tests
      command: 'node ../server/index.js',
      port: 3001,
      reuseExistingServer: true,
    },
    {
      // vite preview serves the already-built dist/
      command: 'npm --prefix ../client run preview -- --port 4173',
      port: 4173,
      reuseExistingServer: true,
    },
  ],
})
