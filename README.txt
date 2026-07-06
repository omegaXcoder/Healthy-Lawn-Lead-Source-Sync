Healthy Lawn NJ — WhatConverts -> ServiceAssistant Lead Source Sync
====================================================================

WHAT THIS DOES
--------------
Pulls unique, qualified (Yes/Pending) Web Form and Phone Call leads from
WhatConverts for the last 7 days, finds the matching customer in the
ServiceAssistant CRM (kiki.serviceassistant.com/809961), and sets the
customer's "Source" dropdown to match the mapping in config/mapping.json.

SETUP (one time)
-----------------
1. cp .env.example .env   (already done in this environment — real values are in .env)
2. npm install
3. npm run auth            -- logs in once, saves session to playwright/.auth/state.json
                               Re-run this whenever the saved session expires
                               (login errors when running sync).

COMMANDS
--------
npm run sync:dry           -- DRY RUN (default & recommended first). Searches the
                               CRM and reports what it WOULD change. Never saves
                               anything. Emails + writes a log to logs/.

npm run sync:dry:headed    -- Same as above but shows the browser window, useful
                               for watching a run or debugging.

npm run sync:live          -- LIVE RUN. Actually selects the mapped Source option
                               and clicks Save for every record that doesn't
                               already match. Only run this after reviewing a
                               dry run's log.

npm run sync:live:headed   -- Live run, visible browser.

npm run report             -- Opens the Playwright HTML report from the last run
                               (screenshots/trace/video on failure).

OVERRIDING THE DATE RANGE
--------------------------
By default the sync pulls "today minus 7 days through yesterday" (7 full days,
excludes today; widened from 4 on 2026-07-06 since some leads take longer than
4 days to get entered as CRM customers). To override for a backfill or reprocessing:

  (Windows, PowerShell)
  $env:START_DATE="2026-06-01"; $env:END_DATE="2026-06-30"; npm run sync:dry

  (Git Bash / macOS / Linux)
  START_DATE=2026-06-01 END_DATE=2026-06-30 npm run sync:dry

LOGS
----
Every run writes a plain-text log to logs/sync-<timestamp>.txt and emails the
same content to omega@kudos.marketing with subject "AUTOMATION LOGGING - Healthy
Lawn NJ Source Sync - DRY RUN" (or "LIVE RUN"), matching the existing email
filter rule. Every lead is logged as exactly one of:

  NOT_FOUND        No CRM customer matched phone/email/name (or phone alone,
                    for Phone Call leads). Nothing was touched.
  AMBIGUOUS        More than one CRM customer matched — skipped, needs a human.
  SKIPPED_DIRECT    Lead source was Direct Visit — per client instructions,
                    these are intentionally left alone.
  UNMAPPED         The lead's source/medium combo has no rule in
                    config/mapping.json (or the rule is explicitly flagged
                    unmapped, like Bing/CPC — see KNOWN GAPS below). Nothing
                    was touched; add a rule to config/mapping.json to fix.
  ALREADY_CORRECT  CRM Source already matches the mapped value. No change made.
  WOULD_CHANGE     Dry run only: this is what a live run would change.
  CHANGED          Live run only: the Source was updated and saved.

KNOWN GAPS (as of 2026-07-06)
------------------------------
- Bing + CPC has no dedicated matching dropdown option in the live CRM (only
  "BNG - Bing Organic" exists, no CPC variant). Client decided (2026-07-06) to
  map Bing/CPC to "BNG - Bing Organic" for now. Revisit if a proper Bing CPC
  source is ever added to the CRM's Source dropdown.

FILES
-----
config/mapping.json   Source/medium -> CRM "Source" dropdown label rules.
lib/whatconverts.ts    WhatConverts API client (date range, lead fetch).
lib/mapping.ts         Resolves a lead to a CRM source label (or skip/unmapped).
lib/mailer.ts          Sends the run log via SMTP.
tests/auth.setup.ts     One-time login, saves session.
tests/sync.spec.ts      The actual sync (dry run by default).
