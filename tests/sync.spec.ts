import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fetchQuotableLeads, resolveDateRange, WhatConvertsLead } from '../lib/whatconverts';
import { resolveCrmSource } from '../lib/mapping';
import { emailLog } from '../lib/mailer';

/**
 * Healthy Lawn NJ — WhatConverts -> ServiceAssistant lead source sync.
 *
 * Dry run (default): searches the CRM, opens the Source dropdown, compares
 * against the mapped value, and LOGS what it would do. Never selects/saves.
 *
 * Live run: set LIVE_RUN=true. Then it actually selects the mapped option
 * and clicks Save for any record whose Source doesn't already match.
 *
 * Run with:  npm run sync:dry   (or sync:live)
 */

const LIVE_RUN = process.env.LIVE_RUN === 'true';

interface LogEntry {
  leadId: number;
  leadType: string;
  source: string;
  medium: string;
  contact: string;
  status: string; // NOT_FOUND | AMBIGUOUS | SKIPPED_DIRECT | UNMAPPED | ALREADY_CORRECT | WOULD_CHANGE | CHANGED | ERROR
  detail: string;
}

const log: LogEntry[] = [];

function digits(phone: string): string {
  return (phone || '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
}

/** Runs the Customer Search form with a single field, returns what happened. */
async function runSearch(
  page: Page,
  field: 'phone' | 'email' | 'lastName',
  value: string,
): Promise<'navigated' | 'single' | 'multiple' | 'none'> {
  // NOTE: no leading slash — a leading slash would resolve against the origin
  // and drop the /809961/ account segment from baseURL. See .env comment.
  await page.goto('Customer/Search/Index');

  // Clear any sticky filter from a previous search so results aren't AND-filtered
  // (confirmed live: a stale phone#/name filter silently ANDs with the next
  // search — a plain reload does NOT clear it, this link specifically does).
  // Wait for the click's own navigation to settle before re-navigating, or the
  // two navigations race and the second goto() gets aborted.
  const clearStickyLink = page.getByRole('link', { name: 'Clear Sticky settings for this page' });
  if (await clearStickyLink.isVisible().catch(() => false)) {
    await clearStickyLink.click();
    await page.waitForLoadState('networkidle').catch(() => {});
  }
  await page.goto('Customer/Search/Index');

  if (field === 'phone') {
    await page.getByRole('textbox', { name: 'Phone #:' }).fill(digits(value));
  } else if (field === 'email') {
    await page.getByRole('textbox', { name: 'Email:' }).fill(value);
  } else {
    await page.getByRole('textbox', { name: 'Last name:' }).fill(value);
  }

  await page.locator('form').getByText('Search', { exact: true }).click();
  await page.waitForTimeout(1500); // settle: results grid renders client-side after the AJAX search

  if (/\/Customer\/Customer\/Index\/\d+\/Detail/.test(page.url())) return 'navigated';

  const noResults = page.getByRole('heading', { name: 'No Results Found.' });
  if (await noResults.isVisible().catch(() => false)) return 'none';

  const rows = page.locator('[role="grid"] tbody tr, [role="grid"] [role="row"]').filter({ has: page.locator('a') });
  const count = await rows.count().catch(() => 0);
  if (count === 0) return 'none';
  if (count === 1) {
    await rows.first().locator('a').first().click();
    await page.waitForTimeout(1500);
    return 'single';
  }
  return 'multiple';
}

/** Finds the matching customer for a lead per the client's search-order rules. Returns true if found. */
async function findCustomer(page: Page, lead: WhatConvertsLead): Promise<boolean> {
  const isWebForm = lead.lead_type === 'Web Form';

  if (lead.phone_number) {
    const r = await runSearch(page, 'phone', lead.phone_number);
    if (r === 'navigated' || r === 'single') return true;
    if (r === 'multiple') {
      log.push({ leadId: lead.lead_id, leadType: lead.lead_type, source: lead.lead_source, medium: lead.lead_medium, contact: lead.contact_name, status: 'AMBIGUOUS', detail: 'Multiple customers matched by phone — needs manual review' });
      return false;
    }
  }

  if (!isWebForm) return false; // Phone Call leads: phone-only per client rule

  if (lead.email_address) {
    const r = await runSearch(page, 'email', lead.email_address);
    if (r === 'navigated' || r === 'single') return true;
    if (r === 'multiple') {
      log.push({ leadId: lead.lead_id, leadType: lead.lead_type, source: lead.lead_source, medium: lead.lead_medium, contact: lead.contact_name, status: 'AMBIGUOUS', detail: 'Multiple customers matched by email — needs manual review' });
      return false;
    }
  }

  if (lead.contact_name && lead.contact_name.trim()) {
    const lastName = lead.contact_name.trim().split(/\s+/).pop()!;
    const r = await runSearch(page, 'lastName', lastName);
    if (r === 'navigated' || r === 'single') return true;
    if (r === 'multiple') {
      log.push({ leadId: lead.lead_id, leadType: lead.lead_type, source: lead.lead_source, medium: lead.lead_medium, contact: lead.contact_name, status: 'AMBIGUOUS', detail: 'Multiple customers matched by last name — needs manual review' });
      return false;
    }
  }

  return false;
}

/** Opens the Customer Details edit panel, reads the true current Source value
 * (the read-only summary strips the "XXX - " prefix, so this must open the
 * dropdown to get the real value), and — live mode only — changes it. */
async function reconcileSource(page: Page, lead: WhatConvertsLead): Promise<void> {
  const mapping = resolveCrmSource(lead.lead_source, lead.lead_medium);
  const base = { leadId: lead.lead_id, leadType: lead.lead_type, source: lead.lead_source, medium: lead.lead_medium, contact: lead.contact_name };

  if (mapping.kind === 'skip') {
    log.push({ ...base, status: 'SKIPPED_DIRECT', detail: mapping.note });
    return;
  }
  if (mapping.kind === 'unmapped' || mapping.kind === 'no_rule') {
    const note = mapping.kind === 'unmapped' ? mapping.note : `No mapping rule for source="${lead.lead_source}" medium="${lead.lead_medium}" — add one to config/mapping.json`;
    log.push({ ...base, status: 'UNMAPPED', detail: note });
    return;
  }

  const panel = page.locator('#DetailCustomerDetails');
  await panel.getByRole('link', { name: 'Edit' }).click();
  await page.waitForTimeout(1000); // settle: edit panel swaps in client-side

  // Confirmed live: the edit panel has a hidden duplicate "Source:" label
  // elsewhere in the DOM, so a text-proximity xpath ("next button after
  // Source:") resolves to 2 elements and throws a strict-mode error. The
  // dropdown's own data-id attribute is unique and stable — use that instead.
  // Its title attribute also holds the untruncated value (belt-and-suspenders
  // alongside the button's visible text, which should be identical).
  const sourceButton = page.locator('#DetailCustomerDetails button[data-id="SourceID"]');
  const currentValue = ((await sourceButton.getAttribute('title')) ?? (await sourceButton.textContent()))?.trim() ?? '';

  if (currentValue === mapping.crmSource) {
    log.push({ ...base, status: 'ALREADY_CORRECT', detail: `Source already "${currentValue}"` });
    await panel.getByRole('link', { name: 'Cancel' }).click().catch(() => {});
    return;
  }

  if (!LIVE_RUN) {
    log.push({ ...base, status: 'WOULD_CHANGE', detail: `Would change "${currentValue}" -> "${mapping.crmSource}"` });
    await panel.getByRole('link', { name: 'Cancel' }).click().catch(() => {});
    return;
  }

  await sourceButton.click();
  // BUG FOUND LIVE 2026-07-06 (#1): clicking the <li> (getByRole('listitem'))
  // does NOT actually select the option — the dropdown's selection handler is
  // bound to the <a> inside each <li>, not the <li> itself. Clicking the
  // outer element silently no-ops.
  //
  // BUG FOUND LIVE 2026-07-06 (#2): a plain `.filter({ hasText }).first()` on
  // the matching <a> elements is NOT enough either — per this project's own
  // "never trust .first on a broad text/class match without checking
  // visibility" rule, there is a hidden/inactive duplicate anchor elsewhere
  // in the DOM (same pattern as the earlier duplicate "Source:" label bug),
  // and .first() can silently click that decoy instead of the real, visible
  // one — the click "succeeds" with no error, but nothing changes. Fix:
  // iterate candidates and click the first one that's actually visible.
  const candidates = page.locator('#DetailCustomerDetails a').filter({ hasText: mapping.crmSource });
  const candidateCount = await candidates.count();
  let clicked = false;
  for (let i = 0; i < candidateCount; i++) {
    const candidate = candidates.nth(i);
    if (await candidate.isVisible()) {
      await candidate.click();
      clicked = true;
      break;
    }
  }
  if (!clicked) {
    log.push({ ...base, status: 'ERROR', detail: `Could not find a visible "${mapping.crmSource}" option in the Source dropdown (${candidateCount} candidates, none visible)` });
    await panel.getByRole('link', { name: 'Cancel' }).click().catch(() => {});
    return;
  }

  // Verify the selection actually registered client-side BEFORE saving —
  // catches bug #2-style no-ops immediately instead of discovering them only
  // after Save, when it's too late to retry cheaply.
  const selectedValue = ((await sourceButton.getAttribute('title')) ?? (await sourceButton.textContent()))?.trim() ?? '';
  if (selectedValue !== mapping.crmSource) {
    log.push({ ...base, status: 'ERROR', detail: `Selected "${mapping.crmSource}" in the dropdown but the button still shows "${selectedValue}" — selection did not register, aborting before Save` });
    await panel.getByRole('link', { name: 'Cancel' }).click().catch(() => {});
    return;
  }

  await panel.getByRole('link', { name: 'Save' }).click();
  // BUG FOUND LIVE 2026-07-06 (#3): a fixed waitForTimeout(1500) here is NOT
  // reliable — Save is an AJAX call, and reload()-ing before it completes
  // aborts the in-flight request, silently discarding the save. Confirmed by
  // reproducing manually (works every time with natural human-speed delays
  // between steps) vs. the automated run (failed twice with the same 1500ms
  // wait). Fix: wait for a real completion signal — the panel reverting from
  // Save/Cancel back to a plain "Edit" link only happens after the AJAX
  // response comes back and the panel re-renders in read-only mode.
  await panel.getByRole('link', { name: 'Edit' }).waitFor({ state: 'visible', timeout: 15_000 });

  // Verify the save actually persisted server-side — reload from the server
  // and re-read the READ-ONLY summary (not the edit-mode button, which only
  // exists while the panel is open). The read-only summary strips everything
  // up to and including the first " - " (confirmed live across GMB/EC/GA/ORG
  // examples), so apply the same stripping to mapping.crmSource before comparing.
  await page.reload();
  await page.waitForTimeout(1000);
  const panelText = await panel.innerText();
  const sourceLine = panelText.match(/Source:\s*\n?\s*([^\n]+)/)?.[1]?.trim() ?? '';
  const expectedStripped = mapping.crmSource.includes(' - ')
    ? mapping.crmSource.slice(mapping.crmSource.indexOf(' - ') + 3)
    : mapping.crmSource;
  if (sourceLine === expectedStripped) {
    log.push({ ...base, status: 'CHANGED', detail: `Changed "${currentValue}" -> "${mapping.crmSource}"` });
  } else {
    log.push({ ...base, status: 'ERROR', detail: `Attempted to change "${currentValue}" -> "${mapping.crmSource}" but post-save reload shows Source "${sourceLine}" (expected "${expectedStripped}") — save did not persist` });
  }
}

test('Healthy Lawn NJ source sync', async ({ page }) => {
  const range = resolveDateRange();
  const leads = await fetchQuotableLeads(range);

  for (const lead of leads) {
    const found = await findCustomer(page, lead);
    if (!found) {
      // findCustomer already logged AMBIGUOUS cases; only log plain not-found here.
      const alreadyLogged = log.some((e) => e.leadId === lead.lead_id);
      if (!alreadyLogged) {
        log.push({
          leadId: lead.lead_id, leadType: lead.lead_type, source: lead.lead_source, medium: lead.lead_medium,
          contact: lead.contact_name, status: 'NOT_FOUND', detail: 'No CRM customer matched phone/email/name',
        });
      }
      continue;
    }
    await reconcileSource(page, lead);
  }

  const summary = [
    `Healthy Lawn NJ source sync — ${LIVE_RUN ? 'LIVE RUN' : 'DRY RUN'}`,
    `Date range: ${range.start} to ${range.end}`,
    `Leads processed: ${leads.length}`,
    '',
    ...log.map((e) => `[${e.status}] lead ${e.leadId} (${e.leadType}, ${e.source}/${e.medium}, "${e.contact}"): ${e.detail}`),
  ].join('\n');

  const logDir = path.join(__dirname, '..', 'logs');
  fs.mkdirSync(logDir, { recursive: true });
  const logFile = path.join(logDir, `sync-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`);
  fs.writeFileSync(logFile, summary);
  console.log(summary);

  await emailLog(LIVE_RUN ? 'LIVE RUN' : 'DRY RUN', summary);

  expect(log.length).toBeGreaterThanOrEqual(0); // always passes; this test is a batch job, not a pass/fail check
});
