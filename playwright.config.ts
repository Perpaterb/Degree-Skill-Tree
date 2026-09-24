import { defineConfig, devices } from '@playwright/test';

// E2E runs against the production build served under the real Pages sub-path.
// Point it at a deployed site with E2E_BASE_URL (e.g. https://perpaterb.github.io/Degree-Skill-Tree/).
const external = process.env.E2E_BASE_URL;

export default defineConfig({
  testDir: 'e2e',
  timeout: 45_000,
  fullyParallel: true,
  // Software GL is CPU-bound; more workers than this starve each other (CI runners have 2-4 cores).
  workers: process.env.CI ? 2 : 4,
  reporter: [['list']],
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    baseURL: external ?? 'http://localhost:4173/Degree-Skill-Tree/',
    // Functional runs use software GL (deterministic, works anywhere). The perf run uses the real GPU.
    launchOptions: process.env.PERF
      ? { channel: 'chromium', args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=vulkan', '--enable-features=Vulkan'] }
      : { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } }, grepInvert: /@phone/ },
    { name: 'phone', use: { ...devices['Pixel 7'] }, grep: /@phone/ },
  ],
  webServer: external
    ? undefined
    : { command: 'npm run build && npm run preview', url: 'http://localhost:4173/Degree-Skill-Tree/', reuseExistingServer: true, timeout: 120_000 },
});
