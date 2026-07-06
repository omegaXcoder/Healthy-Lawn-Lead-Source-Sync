/**
 * WhatConverts API client for Healthy Lawn NJ ("Healthy Lawn SA" in our internal
 * naming — this client uses ServiceAssistant/RealGreen, not Service Autopilot,
 * which is why it's a standalone project instead of living in the multi-client
 * Playwright MCP server pipeline).
 *
 * Confirmed live 2026-07-05:
 *  - account_id 102720 / profile_id 152222 is the only "Healthy Lawn" WhatConverts
 *    account that exists — there is no separate "Healthy Lawn SA" account.
 *  - Auth: HTTP Basic as token:secret.
 *  - duplicate=false -> unique leads only.
 *  - quotable accepts ONE value at a time (yes|no|pending|not_set), so "Yes or
 *    Pending" requires two calls merged + de-duped by lead_id.
 */

export interface WhatConvertsLead {
  lead_id: number;
  lead_type: string; // "Phone Call" | "Web Form" | "Chat" | ...
  lead_source: string;
  lead_medium: string;
  contact_name: string;
  phone_number: string;
  email_address: string;
  quotable: string;
}

export interface DateRange {
  start: string;
  end: string;
}

/** Resolves the run's date range: explicit START_DATE/END_DATE env vars win,
 * else "today minus 7 days through yesterday" (7 full days, excludes today).
 * Widened from 4 to 7 days on 2026-07-06 — the office was taking longer than
 * 4 days to enter some leads as CRM customers, so a 4-day window was missing
 * leads that later would have matched. */
export function resolveDateRange(): DateRange {
  if (process.env.START_DATE && process.env.END_DATE) {
    return { start: process.env.START_DATE, end: process.env.END_DATE };
  }
  const end = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const start = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return { start: fmt(start), end: fmt(end) };
}

export interface WhatConvertsCredentials {
  token: string;
  secret: string;
}

export function apiCredentials(): WhatConvertsCredentials {
  const { WHATCONVERTS_API_TOKEN, WHATCONVERTS_API_SECRET } = process.env;
  if (!WHATCONVERTS_API_TOKEN || !WHATCONVERTS_API_SECRET) {
    throw new Error('Missing WHATCONVERTS_API_TOKEN / WHATCONVERTS_API_SECRET in .env');
  }
  return { token: WHATCONVERTS_API_TOKEN, secret: WHATCONVERTS_API_SECRET };
}

function authHeader(creds: WhatConvertsCredentials): string {
  return 'Basic ' + Buffer.from(`${creds.token}:${creds.secret}`).toString('base64');
}

async function fetchLeadsPage(
  creds: WhatConvertsCredentials,
  profileId: string,
  quotable: 'yes' | 'pending',
  range: DateRange,
  pageNumber: number,
): Promise<{ leads: WhatConvertsLead[]; totalPages: number }> {
  const url = new URL('https://app.whatconverts.com/api/v1/leads');
  url.searchParams.set('start_date', range.start);
  url.searchParams.set('end_date', range.end);
  url.searchParams.set('profile_id', profileId);
  url.searchParams.set('duplicate', 'false');
  url.searchParams.set('quotable', quotable);
  url.searchParams.set('leads_per_page', '2500');
  url.searchParams.set('page_number', String(pageNumber));

  const res = await fetch(url, { headers: { Authorization: authHeader(creds) } });
  if (!res.ok) {
    throw new Error(`WhatConverts API error ${res.status}: ${await res.text()}`);
  }
  const data = await res.json();
  return { leads: data.leads ?? [], totalPages: data.total_pages ?? 1 };
}

/** Pulls all unique, quotable=Yes/Pending leads for the date range, de-duped by lead_id.
 * Restricted to Web Form and Phone Call lead types — those are the only two
 * types the CRM-search rules (phone->email->name vs phone-only) cover. */
export async function fetchQuotableLeads(
  range: DateRange,
  creds: WhatConvertsCredentials = apiCredentials(),
  profileId: string = process.env.WHATCONVERTS_PROFILE_ID ?? '',
): Promise<WhatConvertsLead[]> {
  if (!profileId) throw new Error('Missing profileId (and no WHATCONVERTS_PROFILE_ID in .env)');

  const byId = new Map<number, WhatConvertsLead>();

  for (const quotable of ['yes', 'pending'] as const) {
    let page = 1;
    while (true) {
      const { leads, totalPages } = await fetchLeadsPage(creds, profileId, quotable, range, page);
      for (const lead of leads) byId.set(lead.lead_id, lead);
      if (page >= totalPages) break;
      page++;
    }
  }

  return [...byId.values()].filter((l) => l.lead_type === 'Web Form' || l.lead_type === 'Phone Call');
}
