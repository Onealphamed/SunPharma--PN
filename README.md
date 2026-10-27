# PN0510 Advisory Board Programme — Project Management Dashboard

Client-facing project dashboard for the **Sun Pharma PN0510 Advisory Board programme**: regional boards AB-1 to AB-4 and the national consensus board NAB-5, run by OneAlphaMed. The source of truth is a **live Google Sheet**, created from the `Readiness Checklist` worksheet of `OneAlphaMed_SunPharma_PN0510_AdBoard_Readiness_Checklist_v1.0.xlsx`.

> **Current state.** Live at https://sun-pharma-pn.vercel.app.
> - It reads the Google Sheet `11utniknUlqKEEwh-8_fS2qkM9ttoKbHqUb86dOZLrA0` through its **"Anyone with the link can view"** sharing (view-only link mode, §3A). No credentials are needed.
> - Edits are made in Google Sheets and appear within the sync interval (15 s by default).
> - Visitors need no sign-in (open access, §4).
> - Four pages: Executive Summary, Deliverables Tracker, Timeline / Gantt and Meetings & Minutes (plus Settings for the team). Colours are ~70% OneAlphaMed (deep blue / teal, logo gradient) and ~30% Sun Pharma (orange accents); the tokens are at the top of `client/src/styles.css`.

## Contents
1. What it does
2. Quick start (local)
3. Connect the live Google Sheet
4. Users, roles and client sharing
5. Business rules
6. Deployment
7. Environment variables
8. Project structure
9. Tests, verification and known limitations

---

## 1. What it does

| Section | Highlights |
|---|---|
| **Executive Summary** | Laid out like the EAN tracker's executive view, numbers and charts only. Header with project facts, health and overall progress, plus an **Open Google Sheet** button. Eight KPI tiles (total, active, completed, overdue, due in 7 days, pending approvals, not started, average indicative progress). *Where it's pending — and with whom*: With OneAlphaMed / With Sun Pharma / Closed, with status counts and a split bar. Charts: deliverables by status, progress by phase, key milestones. Every chart has hover details and a table view, and tiles and bars open the matching tracker view. Status colours are a colour-blind-checked set shared with DK0510. |
| **Deliverables Tracker** | Laid out like the EAN project tracker. One filter bar: search, Phase, Owner (OAM), Owner (Client), Priority, Status (incl. Completed and Overdue), Month, Year, Clear. Then a collapsible section per phase showing *N items · X done* and a confirmed-completion bar, with workstream sub-headers and columns SR, Deliverable (name + description), Status, Owner (OAM), Owner (Client), Start, End, Progress, Delay / Left, Priority. No ID column. *Progress* is an indicative stage by status (Yet to Start / Yet to Assign / Pending 0%, In Progress / On Hold 50%, In Review 80%, Under Approval / Approval 90%); only Completion Confirmed = Yes counts as 100% and as done. Click a row for the detail drawer (comments, linked actions, dependencies, slip impact, change history). Excel/CSV export of filtered or complete data. |
| **Timeline / Gantt** | Daily, weekly and monthly views; phase and workstream summary bars; phase-start lines; milestones; approval gates; client inputs; dependencies; critical path once dependencies exist; today line; holidays; baseline vs plan. Items without confirmed dates are listed separately as *Awaiting schedule confirmation*, never drawn from guessed dates. |
| **Meetings & Minutes** | Meeting register (newest first) with search and filters by date, attendee, phase and topic. Full minutes form with auto-assigned `MTG-###` IDs. Each decision line converts to an action item. Action tracker shows linked deliverables and overdue highlighting. Client-ready minutes as PDF (print) or Word. Change history. |
| **Settings / Data Connection** (internal only) | Connection state (Connected / Syncing / Connection Error) with retry; set-up steps; log of failed saves and sync errors; data-quality report; project settings and thresholds; status configuration; working-day calendar; audit log; a what-if "simulate today" date. |

## 2. Quick start (local, no Google credentials needed)

Requires Node.js 20+. This machine has a portable Node at `C:\Users\Admin\.tools\node`. In PowerShell, add it to PATH for the session first:

```powershell
$env:Path = "C:\Users\Admin\.tools\node;$env:Path"
```

Then install, import and run:

```bash
npm install
```

```bash
npm run import -- "D:\Project Management\Sun Pharma\PN\OneAlphaMed_SunPharma_PN0510_AdBoard_Readiness_Checklist_v1.0.xlsx"
```

```bash
npm run dev
```

- Copy `.env.example` to `.env`. Set a random `JWT_SECRET` and `ALLOW_DEV_LOGIN=true` (a working `.env` already exists on this machine).
- Open the URL Vite prints (normally http://localhost:5173). The sign-in page offers one-click **Project manager / OneAlphaMed editor / Sun Pharma viewer** buttons in development only. They are disabled whenever `NODE_ENV=production`.
- The local adapter reads and writes `data/local-store.json`. Editing that file by hand simulates an edit in the Google Sheet: the dashboard picks it up within the sync interval.
- `npm run import -- <xlsx> --force` resets the local data to the checklist and discards local edits.

**What the import does** (full detail in `docs/IMPORT_REPORT.md`):
- Opens the workbook read-only and reads **only** the `Readiness Checklist` worksheet. Overview, Gantt Timeline, KOL Tracker, Board Tracker and Reference are never read. A test plants decoy rows in another sheet to prove this.
- Treats 5 phase headings and 14 workstream headings as structure, giving **114 deliverables** (Phase 1–5: 14 / 14 / 60 / 21 / 5).
- Assigns stable IDs `PN-<section>.<seq>`, e.g. `PN-2.3.03`. They are never renumbered, and the Checklist Row is kept for traceability.
- Copies every source value verbatim, including ◆, en dashes and ≥. Maps `Yet to start` → `Yet to Start` and keeps the original in *Original Status (Checklist)*.
- Fills in nothing missing. All dates start blank, shown as "Date not confirmed". Row 14 (PN-1.3.06) keeps its blank Type, Lead, Duration and Status and is flagged.
- Flags source issues for the PM: placeholder description "ssss" (PN-3.4.11); a reference to a non-existent status "Second review" (PN-2.3.03); text that refers to the Overview tab.
- Produces `output/PN0510_Live_Tracker.xlsx`, the file that becomes the Google Sheet: 11 tabs, frozen headers, drop-downs, internal columns in a darker header colour.

## 3. Connect the live Google Sheet

There are two ways to connect:

| | **A. View-only link** (in use) | **B. Service account** |
|---|---|---|
| Set-up | Share the sheet as *Anyone with the link can view* and set `GOOGLE_SHEET_ID` | Google Cloud service account + key |
| Where edits happen | In Google Sheets only (the dashboard is read-only) | Google Sheets **and** the dashboard (team sign-in) |
| Sheet layout | Your workbook as it is: deliverables come from the **Readiness Checklist** tab | The tracker tabs from `output/PN0510_Live_Tracker.xlsx` |
| Privacy | Anyone with the sheet link can read the whole sheet | The sheet can stay private |

### 3A. View-only link (no credentials)

- **Set-up:** set `GOOGLE_SHEET_ID` to the sheet ID, or paste the whole sheet URL. Leave `GOOGLE_SERVICE_ACCOUNT_JSON` empty. With no key, the dashboard uses this mode automatically.
- **How it reads:** on every sync (default every **15 s**), the server downloads the workbook through Google's export link. It rebuilds the tracker from the **Readiness Checklist** tab using the same rules as the import (§2).
- **Optional extra columns:** add columns to the checklist with the tracker names and they are picked up automatically, e.g. *Planned Start Date*, *Planned End Date*, *Actual Completion Date*, *Completion Confirmed*, *Priority*, *Dependency*, *Next Action*, *Action Owner*, *Target Date*, *Client Approval Status*.
  - Add a **Deliverable ID** column to keep IDs fixed when rows are inserted. Without it, IDs are numbered by position within each section.
- **More tracker data:** tabs named like the tracker tabs (*Meetings*, *Action Items*, *Risks & Issues*, *Decision Log*, *Settings*, …) with the same headers are read too.
- **Sheet link:** the Executive Summary's **Open Google Sheet** button opens the source sheet. Everyone with the dashboard link sees it, so they can also read every tab of the sheet, including contact details in the KOL tabs.
- **Limits:**
  - Dashboard editing (status changes, meeting notes, comments) is switched off in this mode.
  - Turning off link sharing breaks the connection; the dashboard then shows a clear Connection Error.
  - Anyone with the sheet link can read the whole sheet, including contact details. Treat that link as confidential, or switch to 3B.

### 3B. Service account (read/write)

1. **Create the sheet.** Upload `output/PN0510_Live_Tracker.xlsx` to Google Drive, open it, then use **File → Save as Google Sheets**.
   *Alternative:* create an empty Google Sheet and run `npm run sheet:push` after step 4. It creates the tabs and fills only tabs that are empty; it never overwrites data.
2. **Create a service account.** In Google Cloud Console: create a project, enable the **Google Sheets API**, then *IAM → Service accounts → Create → Keys → Add key → JSON*. Keep the key file out of git (`*.key.json` and `config/` are ignored). `C:\Users\Admin\.tools\copy-google-key.ps1` (made for the AZ project) works here too: it base64-encodes the key to the clipboard and prints only the service-account email.
3. **Share the sheet securely.**
   - Share it with the service-account email (`…@….iam.gserviceaccount.com`) as **Editor**.
   - Add OneAlphaMed team members as needed.
   - **Do not share the sheet with Sun Pharma.** Sun Pharma sees the data only through the dashboard, which removes internal rows and columns on the server.
4. **Configure** `.env` (or the host's secrets):
   - `DATA_SOURCE=google`
   - `GOOGLE_SHEET_ID=<the ID between /d/ and /edit in the sheet URL>`
   - `GOOGLE_SERVICE_ACCOUNT_JSON=<raw JSON or base64>`
5. **Verify** with `npm run sheet:push -- --check`. It reads only, and lists each tab, row count and any missing column.
6. **Restart.** The header should show *Connected · Google Sheet*.

**How live sync works.**
- The server re-reads the sheet every `SYNC_INTERVAL_SECONDS` (default 30, minimum 10). Open browsers are told about changes by push (server-sent events) and fall back to polling.
- Saves from the dashboard are written immediately, then re-read.
- Google Sheets has no change webhook without a public endpoint, so this is **near-real-time (≤ 30 s), not instant**.
- Columns are matched by header text, so you can reorder or add columns in the sheet. Renaming a header disconnects that field; the data-quality page reports it.
- Every edit is checked against the value the user started from. If someone else changed it meanwhile, the user gets a "changed by someone else" message instead of silently overwriting. Bulk edits are all-or-nothing.
- Records are addressed by Deliverable ID, never by row number. Duplicate or missing IDs make those rows read-only and are flagged. New IDs are checked against the sheet at write time, so creating a record can never duplicate an ID.
- When the sheet can't be read, the dashboard keeps the last good data, shows **Connection Error** with a retry button, and logs the error under Settings.

## 4. Users, roles and client sharing

**Open access (the default).** Anyone with the link sees the dashboard immediately, with no sign-in:
- Visitors get the read-only **client** view. The server still removes everything internal (see below), so only items marked Client / Client Visible are shown.
- Visitors cannot change anything. The team updates data in the Google Sheet, which reaches the dashboard within the sync interval.
- **Team sign-in** (bottom of the sidebar) is optional. It's only needed to edit from the dashboard itself, and needs accounts plus `JWT_SECRET`.
- With no accounts configured, Vercel needs only `GOOGLE_SHEET_ID` and `GOOGLE_SERVICE_ACCOUNT_JSON`.
- Set `PUBLIC_ACCESS=false` to require sign-in for everyone again.
- Remember that open means anyone the link is forwarded to can read the client view, and search engines are told not to index it (`noindex`). Keep internal content marked Internal.

| Role | Sees | Can change |
|---|---|---|
| `admin` (Project Manager) | Everything, including internal notes, audit log and data quality | All fields, including baselines, phase/workstream, Client Visible, statuses, settings and the executive narrative. Can archive (soft-delete) rows. |
| `editor` (OneAlphaMed team) | Everything | Day-to-day fields: status, dates, owners, completion, approvals, comments, risks, meetings and actions |
| `client` (Sun Pharma) | Client-visible rows and columns only | Nothing (read-only); can download reports |

Add users with:

```bash
npm run user:add -- someone@sunpharma.com "Full Name" client
```

- A strong password is printed once. Accounts are stored as bcrypt hashes in `config/users.json`.
- On hosts without a disk, put the same JSON in `USERS_JSON`; `npm run user:json` prints it on one line.

**Confidentiality is enforced on the server** (`server/src/permissions.ts`), not just hidden in the UI:
- Clients never receive: internal columns (Internal Notes, escalation notes, Updated By, Original Status, Client Visible…); rows with `Client Visible = No` or `Visibility = Internal`; the audit log; the data-quality report; or sync error details.
- New meetings, actions, risks, decisions and comments start as **Internal** until someone chooses to share them.
- Sessions use signed httpOnly cookies (Secure in production) with an anti-CSRF header.
- Sign-in is rate-limited, and helmet sets a strict Content Security Policy.

## 5. Business rules

All rules live in `shared/project.ts`. The browser, server and exports share that code, so every number agrees.

- **Statuses.** The brief's eight statuses are used exactly: In Progress, In Review, Yet to Start, Yet to Assign, On Hold, Under Approval, Approval, Pending.
  - Other spellings and capitalisations are mapped to them, and the original value is kept.
  - Colours and definitions are editable in the *Status Config* tab.
  - Badges show the status name with a coloured dot, so meaning never depends on colour alone.
- **Completion.** A deliverable is complete **only** when *Completion Confirmed = Yes*.
  - No status counts as complete; in particular **"Approval" ≠ approved ≠ complete**.
  - This is the controlled enhancement the brief allowed instead of adding a "Completed" status. A PM could add such a status in Status Config with *Counts as Complete = Yes*.
- **Approval decision** (*Client Approval Status*: Not Required / Not Submitted / Pending Approval / Approved / Rejected) is kept separate from the workflow Status.
- **% complete** = complete ÷ all active (non-archived) deliverables, for the project and for each phase.
- **Overdue** = Planned End Date before today and not complete. A completed item is never overdue. **Due soon** = not complete and due within 7 days (setting *Due Soon Days*).
- **Schedule Flag (calculated)**, checked in this order:
  1. *Completed*
  2. *Overdue*
  3. *At Risk*
  4. *On Track* (dated and started, or start date reached)
  5. *Upcoming*

  The checklist's original flag is kept in *Schedule Flag (Checklist)*.
- **At risk** = not complete, not overdue, and any of:
  - on hold
  - start date passed but not started
  - due within 3 working days and not started
  - planned window shorter than the required duration
  - planned end later than baseline
  - risk/blocker recorded
  - dependency overdue
  - no owner
  - next action past its target date
  - approval decision past due
- **Missing dates** are never filled in. Such items are "Date not confirmed", excluded from overdue/due-soon tracking, and listed on the Gantt as awaiting confirmation.
  - Overall health shows **"Schedule not confirmed"** (grey) until any open item has dates.
  - Health is red for an overdue milestone or gate, >10% of items overdue, or an open high-severity issue; amber for anything overdue, at risk or on hold, or an open high risk.
- **Working days.** Mon–Fri by default (*Weekend Days* setting) minus the *Holidays* tab, which starts empty because the checklist has no holidays.
  - *Duration (Working Days)* is the checklist effort. The *planned window* is calculated from the dates, and a mismatch is flagged.
  - In the edit form, "Use <date>" offers the end date implied by start + duration; this is never applied automatically.
- **Baseline.** Captured automatically the first time planned dates are saved from the dashboard; after that only the PM can change it. (Dates typed straight into the sheet do not set a baseline.)
- **Review turnaround.** 5 working days, as *proposed* in the checklist (PN-1.2.04), and labelled "proposed" until *Review Turnaround Confirmed = Yes*. Approval due date = recorded date, otherwise Submission Date + turnaround.
- **Awaiting Sun Pharma** = Lead = Sun, or Type = Client Input, or approval pending. Everything else that is open is **awaiting OneAlphaMed**.
- **Narrative.** Rule-based text built from the data. Where data is missing it says "not confirmed". The PM can edit and save it (Settings › *Executive Narrative*); reports then use the edited version and say so.

## 6. Deployment

The app is one Node service: API plus the built React client.

### Vercel (same set-up as the AZ dashboard)

`vercel.json` and `scripts/build-vercel.mjs` build static files plus one serverless function (region `bom1`, Mumbai).

1. Push the repo to GitHub and import it in Vercel.
2. In *Settings → Environment Variables* (Production), set:
   - `GOOGLE_SHEET_ID`
   - `GOOGLE_SERVICE_ACCOUNT_JSON`
   - Only if you want team sign-in for editing: `JWT_SECRET` (`C:\Users\Admin\.tools\new-jwt-secret.ps1` puts one on the clipboard) and `USERS_JSON`
3. Redeploy.

On Vercel, each request refreshes data older than the sync interval and browsers poll (there is no push channel). Direct sheet edits are not written to the Audit Log there, because several function instances would log duplicates.

### Docker / any Node host

```bash
docker build -t pn0510-dashboard .
```

```bash
docker run -p 8080:8080 --env-file .env.production pn0510-dashboard
```

Without Docker: `npm ci && npm run build && npm start`. Run **one instance**: the background poller and the sheet-edit audit assume a single server.

**Sharing with the client:**
- Deploy behind HTTPS (Vercel does this).
- With open access, send the dashboard URL. No accounts or passwords are needed to view. With `PUBLIC_ACCESS=false`, create one `client` account per person instead.
- Share only the dashboard URL, never the sheet.
- Search engines are told not to index the site (`noindex`).

## 7. Environment variables

See `.env.example`. Secrets are read only by the server and never bundled into the frontend.

| Variable | Required | Purpose |
|---|---|---|
| `DATA_SOURCE` | yes (locally) | `google` (service account if a key is set, otherwise the view-only link), `public-sheet` (view-only link), or `local`. On Vercel it is chosen automatically |
| `GOOGLE_SHEET_ID` | google | Spreadsheet ID, or the full sheet URL |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | google | Service-account key as JSON or base64 (or `GOOGLE_APPLICATION_CREDENTIALS` = a key file path) |
| `PUBLIC_ACCESS` | no | Default `true`: read-only view without sign-in. `false` requires sign-in for everyone |
| `JWT_SECRET` | if anyone can sign in | 32+ random characters; required in production whenever accounts exist or `PUBLIC_ACCESS=false` |
| `USERS_FILE` / `USERS_JSON` | if anyone can sign in | User accounts (bcrypt hashes); not needed for open access without team sign-in |
| `SYNC_INTERVAL_SECONDS` | no | How often the sheet is re-read: default 15 (view-only link) or 30, minimum 10 |
| `PROJECT_TIME_ZONE` | no | Defines "today" (default `Asia/Kolkata`) |
| `ALLOW_DEV_LOGIN` | no | One-click development sign-in; ignored in production |

## 8. Project structure

```
shared/         Domain logic shared by server and browser
  schema.ts       Every sheet tab and column, edit rights, client visibility
  model.ts        Parsing and validation of raw sheet values
  status.ts       The eight statuses, categories and colours
  project.ts      KPIs, completion, flags, health, approvals, narrative
  dates.ts        Working-day calendar maths
  graph.ts        Dependencies, cycles, critical path, slip impact
  quality.ts      Data-quality checks
  suggestions.ts  Dependency suggestions from checklist remarks
server/src/     Express API
  DataService.ts  Sync engine, validated write-back, conflicts, audit, error log
  store/          GoogleSheetsStore (Sheets API v4) and FileStore (local adapter)
  checklistImport.ts  Readiness Checklist → tracker tabs (+ report)
  permissions.ts  Server-side client/internal projection
  export.ts       Excel/CSV
  auth.ts, app.ts, config.ts, index.ts, vercel.ts
server/scripts/ import-checklist, push-to-sheet, add-user
client/src/     React 18 + Vite (no UI framework; plain CSS)
  pages/          Summary, Tracker, Gantt, Meetings, Settings
  reports.ts      The eight report documents (HTML → PDF/Word)
docs/IMPORT_REPORT.md   What was imported, mapped and flagged
```

**Where data lives.** Everything is in the one Google Sheet: Deliverables, Status Config, Settings, Holidays, Phases, Risks & Issues, Decision Log, Meetings, Action Items, Comments and Audit Log. There is no second database, so there are no competing sources of truth. Browser storage holds only per-user conveniences: chosen columns and a simulated date.

## 9. Tests, verification and known limitations

`npm test` runs 44 automated tests (all passing):
- **Business rules:** completion; overdue never set on completed items; missing dates; due-soon and at-risk flags; health; status mapping; approval due dates in working days; narrative; data quality; cycles; dependency suggestions.
- **Import:** only the Readiness Checklist is read (decoy sheet); headings excluded; text kept verbatim; blanks not filled in. Against the real workbook: 114 / 5 / 14, unique IDs, phase counts 14/14/60/21/5, original file byte-identical afterwards.
- **API:** authentication; CSRF; client confidentiality; status write-back with audit; capitalisation mapping; conflict detection; validation; baseline capture; bulk all-or-nothing; no duplicate IDs under concurrent creates; comment authorship; meetings persisted across restart; internal-by-default; direct sheet edits picked up and audited; duplicate/missing IDs read-only; source failure keeps last good data without leaking internals; exports.

**Checked by hand in the browser** (local adapter):
- A status change in the tracker was written to the data file with timestamp, user and audit entry.
- An edit made directly in the data file appeared on the dashboard within one poll. KPIs, overdue, due-soon and health recalculated; the Gantt drew only dated items.
- A meeting was created, and a decision line was converted into an action linked to PN-1.3.01. The action showed on that deliverable and was highlighted as overdue.
- The Sun Pharma role saw no internal meeting, action, column, audit or data-quality data, and no edit controls.
- No horizontal page overflow on any page at 375 px, 768 px and desktop widths.

**Known limitations / needs configuration:**
- **Not live yet.** Needs a Google service account and the sheet (§3). The connector was tested against a simulated store, not a real Google Sheet.
- Sync is near-real-time (≤ the poll interval), not instant.
- Not visually checked: the print dialog (Print / Save as PDF) and opening the Word download in Word.
  - The Word export is an HTML-based `.doc`, which Word opens in Print Layout; it is not a native `.docx`.
  - Printing uses the browser's print-to-PDF.
- Attachments are stored as links (one per line), not uploaded files.
- No email/notification workflow, by design (the brief forbids automatic sending).
- Edits made directly in the sheet are attributed to "Source sheet" in the audit log; Google's own version history shows who made them.
- Planned dates typed straight into the sheet don't set a baseline; the PM can set it in the dashboard.
