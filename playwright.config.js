import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests', workers: 1, reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:1420', ...(process.platform === 'win32' ? {channel:'msedge'} : {browserName:'chromium'}), viewport: {width:1160,height:790} },
  webServer: { command: 'npm run dev', url: 'http://127.0.0.1:1420', reuseExistingServer: true },
});
