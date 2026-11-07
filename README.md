# BeenTried

A field guide to startup ideas that keep attracting founders and keep failing. Each entry lists the companies that tried, how they ended, the failure modes they shared, and what would have to be true for a new attempt to work. Visitors can discuss each entry, vote on whether it's still a tarpit, and run their own idea through a checker.

**Stack:** [Hono](https://hono.dev) on Node with server-rendered JSX, [htmx](https://htmx.org) for interactivity, Postgres with pgvector. With no database configured it runs on [PGlite](https://pglite.dev), an embedded Postgres, so local dev needs nothing but Node.

## Run it

Requires Node 20.12 or newer.

```bash
npm install
npm run dev
```

Open http://localhost:3000. On first start the server creates the schema and loads the entries in `content/tarpits/`.

To configure anything, copy `.env.example` to `.env`. All settings are optional:

| Setting | What it does |
| --- | --- |
| `OPENAI_API_KEY` | Turns on semantic matching and AI-written assessments in the idea checker. Without it the checker uses keyword matching. |
| `ADMIN_PASSWORD` | Turns on `/admin` for hiding comments, marking entries reviewed, and seeing what ideas people checked. |
| `DATABASE_URL` | Uses a real Postgres instead of PGlite. Needs the pgvector extension. |
| `SESSION_SECRET` | Salt for hashing IPs and visitor ids. Set a long random value in production. |
| `REPORT_WEBHOOK_URL` | Slack or Discord webhook that gets a message for each new report. |
| `REPORT_AUTOHIDE_PER_HOUR` | Site-wide cap on reports hiding companies per hour (default 20). |
| `COMPLAINTS_EMAIL` | Complaints and privacy contact, shown on report forms, the footer, About and `/privacy`. |
| `PUBLISH_DRAFTS` | Show unreviewed entries to visitors. Defaults to on in development, off in production. |

## Adding and editing entries

The database is the only source of truth. Everything is edited in `/admin` (set `ADMIN_PASSWORD` in `.env` to turn it on):

- **New entry** creates an entry from its title, category, summary and text.
- **Edit** on any entry opens the editor, where you can change the text, add, edit or remove companies in "Who tried", manage the failure reasons and sources, mark it reviewed, or delete it.

Each failure reason uses a label from `src/tags.ts` (`cold-start`, `unit-economics`, `incumbents` and so on). The label is shown on the page and decides which question the idea checker asks. Add new labels there when the existing ones don't fit.

New entries start as **unreviewed** and show a fact-check notice until you tick "Reviewed" in the editor or click **Mark reviewed** in the entries list. In production, unreviewed entries are hidden from visitors (index, entry pages and the idea checker) unless you set `PUBLISH_DRAFTS=true`; use **Preview** in `/admin` to see them. The **Needs checking** table in `/admin` lists every unreviewed entry and every company without a source link.

### Verdicts and companies still operating

Each entry has a **verdict**, your editorial call, shown as a badge and as a filter on the home page. It is kept separate from the visitors' "still a tarpit / cracked" vote:

- **Tarpit**: nobody has made it work. Needs at least 2 ended companies with sources (`MIN_ENDED_FOR_TARPIT` in `src/verdicts.ts`). An entry can't be marked reviewed until it has them, and the **Needs checking** table flags any that fall short.
- **Contested**: mostly failures, but someone is making it work.
- **Cracked**: someone has clearly made it work. The entry page headings become "Why it used to fail" and "What changed".

Each company is either **ended** (listed under "Who tried") or **active** (listed under "Still operating"). Active means still doing this idea today, including after an acquisition (Venmo, Ring). A company that pivoted away counts as ended. Set it with "Listed under" in the editor. The idea checker names the companies still operating and, for contested or cracked entries, asks what the founder's edge over them is.

`npm run apply-verdicts -- <file.json>` applies a reviewed list of company states, removals and verdicts (see `content/additions/2026-11-verdicts.json`). It is a dry run unless you add `--apply`.

The privacy policy at `/privacy` (`PrivacyPage` in `src/views/pages.tsx`) describes what this code collects. Update it, and its date, whenever that changes.

> The six starter entries were drafted from general knowledge and have not been fact-checked. Verify the dates, outcomes and sources before publishing.

### JSON import and export

JSON files are only a way to move content in and out of the database:

- **Starter content.** When the database is empty, the server imports `content/tarpits/*.json` on startup.
- **`npm run seed`** imports any JSON file whose URL name (`slug`) isn't in the database yet, which is handy for bulk-adding entries. It never changes existing entries.
- **`npm run export`** writes every entry, including all its companies, reasons, sources and status, to `content/tarpits/`. Commit the result to keep a backup in git, or use it to fill a fresh production database. `npm run export -- some/other/folder` writes somewhere else. Comments, votes and pending suggestions aren't exported; back up the database itself for those.

With PGlite (no `DATABASE_URL`), stop the dev server before running either script, because only one process can open the database at a time.

## Companies suggested by visitors

Under each entry's "Who tried" column, visitors can suggest another company. A suggestion needs a company name, how it ended and a source link; years, a one-line note and the visitor's name are optional. Suggestions are stored separately and are never shown publicly until you approve them.

In `/admin`, each pending suggestion shows its source and warns if a company with the same name is already listed. Edit any field, then approve or reject. Approved companies appear on the entry straight away with an "Added by" credit, and you can remove them later from the same page.

Limits: a hidden honeypot field, 5 suggestions per IP per hour, field length checks, years between 1980 and this year, and duplicates (already listed or already waiting) are refused.

Approved companies become ordinary rows in the entry's "Who tried" list, so you can edit or remove them in the entry editor like any other company. They keep the visitor's name for the credit line, and `npm run export` includes them.

## Reports on "Who tried"

Every company under "Who tried" has a **Report a problem** link. A visitor picks a reason (wrong, unfair or damaging, private information, something else), explains, and can leave an email for a reply.

- **The company is hidden straight away.** The report and the hide happen in one database statement, so nothing else has to work for a takedown to happen. The entry shows "One more company is hidden while a report is checked" without naming it.
- **A background check runs after the visitor gets their reply.** It loads the company's source link and notes whether it works. With `OPENAI_API_KEY` set it also writes an advisory assessment (likely valid, likely abuse or unclear, whether the source supports the listing, and suggested wording). It can't change anything, and it treats the report text and source page as untrusted.
- **You decide in `/admin`** under **Reported companies**: restore as it was, edit and restore, or remove. Every hide, restore, edit and removal is recorded in the `moderation_log` table with a timestamp, including removals from the entry editor.
- **Notifications:** set `REPORT_WEBHOOK_URL` to a Slack or Discord incoming webhook. The message leaves out what the reporter wrote and their email.

Comments have a **Report** link that works the same way: the comment is hidden on report and waits under **Reported comments** in `/admin`, where you can show it again or keep it hidden. Keeping it hidden never deletes it, so replies and the record survive. Showing a comment from the "Recent comments" table also closes its open reports.

Limits: a honeypot field, 5 reports per IP per hour, one open report per visitor per company, and a site-wide cap of `REPORT_AUTOHIDE_PER_HOUR` (default 20) auto-hides per hour. Past the cap, reports still queue but the company stays listed until you act, so one person can't empty the site. Hidden companies stay hidden through `npm run export` and re-import. Reports themselves aren't exported.

## How it fits together

```
src/
  server.tsx      Routes, middleware (CSRF, secure headers, visitor cookie), boot
  db.ts           Postgres or PGlite behind one small query interface
  data.ts         All queries for pages, comments, votes and admin
  content.ts      JSON import/export and embedding refresh
  admin-data.ts   Entry editor: create and edit entries, companies, reasons, sources
  check.ts        Idea checker: pgvector + LLM, with keyword fallback
  suggestions.ts  Visitor-suggested companies: validation, duplicates, review queue
  reports.ts      Reports on listed companies: hide, background check, review actions
  ai.ts           OpenAI embeddings and chat via fetch (any compatible endpoint)
  tags.ts         Failure-reason vocabulary and the questions each one raises
  rate-limit.ts   In-memory limits for comments, votes and checks
  views/          JSX pages and htmx partials
db/schema.sql     Idempotent schema, applied on every start
public/           CSS and favicon
```

htmx handles live search (`hx-get` with `hx-select`), posting comments and replies, voting, company suggestions, the idea checker and admin actions. Every form also works without JavaScript.

Spam protection is basic: a honeypot field, per-IP rate limits and admin hiding. Add sign-in (for example GitHub OAuth) before the site gets real traffic.

## Deploying

Any host that runs a Node process works (Fly.io, Railway, Render). Use a managed Postgres with pgvector (Supabase, Neon, Railway) via `DATABASE_URL`, set `SESSION_SECRET`, `PUBLIC_URL` and `NODE_ENV=production`, and run `npm start`. The rate limiter keeps its state in memory, so move it to Redis if you run more than one instance.
