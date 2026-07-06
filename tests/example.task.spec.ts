import { test, expect } from '@playwright/test';

/**
 * TEMPLATE for a task automation.
 *
 * This test starts ALREADY LOGGED IN — the storageState from auth.setup.ts is
 * applied automatically via playwright.config.ts (the `chromium` project).
 * So there is no login code here; go straight to the task.
 *
 * Copy this file per automation and let the Playwright MCP agent fill it in
 * following PLAYWRIGHT-SOP-AGENT.md (reliability-first, generous waits).
 */

test('example: open a quote', async ({ page }) => {
  // Inputs that change per run — parameterize, never hardcode inline.
  // const quoteId = process.env.QUOTE_ID ?? '...';

  await test.step('go to the work area', async () => {
    await page.goto('/'); // baseURL comes from .env
    // Prefer role/label/text selectors; drop to CSS only as a last resort.
    // await page.getByRole('link', { name: 'Quotes' }).click();
  });

  await test.step('verify we landed where we expect', async () => {
    // Condition wait with a generous timeout — reliable AND patient.
    // await expect(page.getByRole('heading', { name: /quotes/i })).toBeVisible();
  });

  // Deliberate settle pause after a save/submit is fine here — reliability
  // beats speed. Document why in the Selector & Wait Rationale.
  // await page.waitForTimeout(3000);
});
