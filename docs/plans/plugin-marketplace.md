# LibreCode Plugin Marketplace — Implementation Plan

> Comprehensive plan for mcpappfoundry.app and the LibreCode integration that
> consumes it. Written 2026-05-22 as Phase 39 (formerly tracked) in PLAN.md.
> Picks up from the v0.9.64 scaffold that already wired the server proxy +
> install dialog.

---

## TL;DR

**What ships:** a curated, searchable registry of MCP apps and LibreCode
plugins, hosted at `mcpappfoundry.app`, with one-click install from LibreCode's
Start menu and a publishing pipeline for authors.

**Why it's strategic:** the v0.9.74 Agentic Control Panel + the curated git-repo
catalog (Superpowers etc.) proved the install-from-URL flow works end-to-end.
The marketplace is the discovery layer on top — turning "paste this git URL"
into "search for what you need." It's also the moat against forks: a vibrant
ecosystem stays with LibreCode rather than getting reabsorbed by whoever
re-implements MCP-Apps next.

**What's already done** (v0.9.64 scaffold):

- Server: `routes/marketplace.ts` — proxies `/marketplace/apps`,
  `/marketplace/install` (currently stubbed). 5-minute LRU cache.
- Frontend: `marketplace-dialog.tsx` + `marketplace-client.ts` — search UI,
  install button (stubbed), rendered in the Start menu.
- Schema: `MarketplaceApp` Zod schema covers npm / pypi / github / remote /
  manifest install kinds + author + capabilities + stats + verified flag.

**What this plan adds:** the host-side service, the publishing pipeline,
real install execution, signing/verification, governance, and the UX
polish that makes it feel like a real app store.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│  mcpappfoundry.app  (Cloudflare Workers + D1 + R2)                   │
│                                                                       │
│  ┌────────────────┐    ┌────────────────┐    ┌──────────────────┐   │
│  │ /api/v1/apps   │    │ /api/v1/        │    │ /api/v1/         │   │
│  │   (search,     │    │   publish      │    │   moderate       │   │
│  │   filter,      │    │   (auth'd)     │    │   (admin-only)   │   │
│  │   ranking)     │    │                │    │                  │   │
│  └────────┬───────┘    └────────┬───────┘    └────────┬─────────┘   │
│           │                     │                     │              │
│           └─────────────┬───────┴─────────────────────┘              │
│                         ▼                                            │
│            ┌──────────────────────────┐                              │
│            │  D1 SQLite               │  ← canonical app metadata    │
│            │  (apps, versions,        │                              │
│            │   authors, reviews,      │                              │
│            │   installs, signatures)  │                              │
│            └──────────────────────────┘                              │
│                                                                       │
│            ┌──────────────────────────┐                              │
│            │  R2 object storage       │  ← screenshots, signed       │
│            │  (assets, manifests,     │     manifest bundles         │
│            │   download counts)       │                              │
│            └──────────────────────────┘                              │
└──────────────────────────────────────────────────────────────────────┘
                              ▲
                              │ HTTP/JSON
                              │
┌─────────────────────────────┼────────────────────────────────────────┐
│  LibreCode client                                                     │
│                                                                       │
│  Start menu  ──▶  Marketplace dialog  ──▶  Install                   │
│                   (search, browse,         (real MCP.add +           │
│                    install, ratings)        signature verify)        │
│                                                                       │
│                   Reviews / ratings (auth'd via LibreCode account)   │
└──────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────┐
│  Publishing tooling (CLI for plugin authors)                          │
│                                                                       │
│   librecode publish ./my-app    ──▶   sign + upload to               │
│                                       mcpappfoundry.app              │
└──────────────────────────────────────────────────────────────────────┘
```

---

## Phase 39a — Host service (mcpappfoundry.app)

**Stack decision:** Cloudflare Workers + D1 + R2.

- Already paying for Cloudflare on the domain. Free tier covers expected
  early load (D1: 5 GB free, 5M reads/day; R2: 10 GB free; Workers: 100k
  requests/day).
- TypeScript end-to-end — same runtime story as LibreCode.
- Edge-cached search results are the killer feature; D1 + Workers makes
  that ~free.
- Migration path: if we outgrow the free tier, Workers + Hyperdrive →
  Postgres is straightforward; D1 export is a single SQL dump.

**Repo layout** (new repo: `techtoboggan/mcpappfoundry`):

```
mcpappfoundry/
├── packages/
│   ├── api/           # Cloudflare Worker (Hono router)
│   │   ├── src/
│   │   │   ├── index.ts          # entrypoint
│   │   │   ├── routes/
│   │   │   │   ├── apps.ts       # search, get, list-by-author
│   │   │   │   ├── publish.ts    # auth'd app submission
│   │   │   │   ├── reviews.ts    # post + read reviews
│   │   │   │   ├── moderate.ts   # takedown, verify
│   │   │   │   └── analytics.ts  # install pings (privacy-respecting)
│   │   │   ├── db/
│   │   │   │   ├── schema.sql    # D1 migrations
│   │   │   │   └── queries.ts    # prepared statements
│   │   │   ├── signing/
│   │   │   │   └── sigstore.ts   # verify manifest signatures
│   │   │   └── search/
│   │   │       └── rank.ts       # relevance + popularity scoring
│   │   ├── wrangler.toml
│   │   └── package.json
│   ├── web/           # static landing page (Astro)
│   │   └── pages/
│   │       ├── index.astro       # homepage with featured apps
│   │       ├── app/[id].astro    # public app detail page
│   │       ├── author/[id].astro # author profile
│   │       └── docs/             # publishing docs
│   └── cli/           # `mcpappfoundry` CLI for authors
│       └── src/
│           └── publish.ts        # bundle, sign, upload
└── docs/
    ├── publishing.md
    ├── manifest-format.md
    └── signing.md
```

### Data model

```sql
-- apps: one row per published app (latest version pointer)
CREATE TABLE apps (
  id              TEXT PRIMARY KEY,           -- 'multica', '@anthropic/skills', etc.
  name            TEXT NOT NULL,
  description     TEXT NOT NULL,
  author_id       TEXT NOT NULL REFERENCES authors(id),
  homepage        TEXT,
  repository      TEXT,
  latest_version  TEXT NOT NULL,
  capabilities    TEXT NOT NULL,              -- JSON array
  install_kind    TEXT NOT NULL,              -- 'npm' | 'github' | 'remote' | 'manifest'
  install_spec    TEXT NOT NULL,              -- JSON, validates against AppInstall schema
  verified        INTEGER DEFAULT 0,          -- moderation flag
  install_count   INTEGER DEFAULT 0,
  rating_sum      INTEGER DEFAULT 0,          -- denormalized for ranking
  rating_count    INTEGER DEFAULT 0,
  created_at      INTEGER NOT NULL,           -- unix ms
  updated_at      INTEGER NOT NULL,
  takedown_reason TEXT                        -- non-null = hidden
);

-- app_versions: history of every published version (for rollback / pinning)
CREATE TABLE app_versions (
  app_id          TEXT NOT NULL REFERENCES apps(id),
  version         TEXT NOT NULL,
  install_spec    TEXT NOT NULL,
  manifest_sha256 TEXT NOT NULL,              -- content-addressed in R2
  signature       TEXT NOT NULL,              -- sigstore signature
  signed_by       TEXT NOT NULL,              -- key id from sigstore
  changelog       TEXT,
  published_at    INTEGER NOT NULL,
  yanked          INTEGER DEFAULT 0,          -- author can yank a bad release
  PRIMARY KEY (app_id, version)
);

-- authors: GitHub OAuth-backed identity
CREATE TABLE authors (
  id              TEXT PRIMARY KEY,           -- 'gh:techtoboggan' etc.
  display_name    TEXT NOT NULL,
  github_login    TEXT,
  email           TEXT,                       -- private, for moderation contact
  verified        INTEGER DEFAULT 0,          -- foundry-verified author
  created_at      INTEGER NOT NULL
);

-- reviews: one per (user, app), updatable
CREATE TABLE reviews (
  id              TEXT PRIMARY KEY,
  app_id          TEXT NOT NULL REFERENCES apps(id),
  user_id         TEXT NOT NULL,              -- LibreCode account id
  rating          INTEGER NOT NULL,           -- 1-5
  body            TEXT,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  flagged         INTEGER DEFAULT 0,
  UNIQUE (app_id, user_id)
);

-- installs: anonymous, daily-rolled-up counters (NOT per-user tracking)
CREATE TABLE installs_daily (
  app_id          TEXT NOT NULL REFERENCES apps(id),
  date            TEXT NOT NULL,              -- 'YYYY-MM-DD'
  count           INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (app_id, date)
);
```

**Privacy:** installs are recorded as anonymous daily counters keyed on
app_id + date. No user identity, no IP, no fingerprinting. This is a
deliberate constraint — the moat is being the place people TRUST to
install plugins, and "we don't know who installed what" is part of that.

### API surface (v1)

```
GET  /api/v1/apps?q=<query>&limit=<n>&cursor=<token>&capability=<cap>
GET  /api/v1/apps/:id
GET  /api/v1/apps/:id/versions
GET  /api/v1/authors/:id
GET  /api/v1/authors/:id/apps

POST /api/v1/publish              (auth'd: author bearer token)
POST /api/v1/yank                 (auth'd: author bearer token)
POST /api/v1/install-ping         (anonymous, daily counter)

POST /api/v1/reviews              (auth'd: LibreCode account)
PATCH /api/v1/reviews/:id         (auth'd: review author)

POST /api/v1/moderate/takedown    (admin-only)
POST /api/v1/moderate/verify      (admin-only)
POST /api/v1/moderate/flag        (any auth'd user, rate-limited)
```

All routes return JSON. CORS allows `librecode://` (Tauri scheme) and
`http://localhost:*` (dev). Search is the hot path — must respond in
<100ms p95 from the edge.

### Search & ranking

Simple, deterministic, no ML to start:

```
score = log10(install_count + 1) * 0.3
      + (rating_sum / max(rating_count, 1)) * 0.2
      + (verified ? 0.1 : 0)
      + recency_decay(updated_at) * 0.2
      + bm25(query, name + description) * 0.2
```

D1 doesn't have full-text search natively. Options:

1. Pre-tokenize at publish-time into an `app_search_terms` table, score in
   the query.
2. Use a Cloudflare Vectorize embedding index (overkill for v1).
3. Bring our own BM25 implementation (~150 lines, runs in the Worker).

→ **Pick 1 for v1.** Move to 3 when there are >1k apps.

### Trust & safety

- **Signing.** Every published manifest gets a sigstore signature. The
  Worker verifies before storing. LibreCode verifies again at install
  time. Unsigned apps are rejected (we control both ends).
- **Sandboxing.** Already in place from Phase 15-16: MCP apps run in
  null-origin iframes; tool calls go through the permission gate;
  download-file requires confirm. The marketplace doesn't loosen any
  of this.
- **Moderation queue.** Every new app submission lands in a pending
  state, visible only via direct URL. Promoted to public after a
  human review. Initial bar is low (anti-malware, name squatting) — we
  trust the developer ecosystem the way npm does. Verified badges go to
  authors who establish a track record.
- **Takedown.** Single admin endpoint marks an app row as taken-down.
  Subsequent installs fail with a structured error pointing at the
  takedown reason. Already-installed instances keep working (no
  remote kill switch — privacy posture).

### Cost model

- Cloudflare Workers free tier: 100k req/day. Sufficient for low-thousand
  daily-active marketplace users with the LibreCode-side cache.
- D1 free tier: 5 GB + 5M reads/day. Each search hits ~1 query; install
  pings are 1 INSERT. Even at 10x current LibreCode adoption we stay free.
- R2 free tier: 10 GB storage + 1M Class A ops/month. Manifest bundles
  are small (~10 KB each); screenshots compress to ~100 KB. At 1000
  apps that's 100 MB — well under the cap.

Migration trigger: when D1 reads exceed 4M/day for a week. Path: Hyperdrive
→ managed Postgres ($25/mo neon.tech tier).

---

## Phase 39b — LibreCode integration

The v0.9.64 scaffold is the foundation. What's left:

### 1. Real install execution

Currently `/marketplace/install` returns a stub. Replace with:

```ts
// packages/librecode/src/server/routes/marketplace.ts
async function realInstall(app: MarketplaceApp): Promise<InstallResult> {
  // 1. Fetch + verify manifest from R2 (sigstore verify)
  const manifest = await fetchSignedManifest(app)

  // 2. Map install_kind to the right MCP.add() or Plugin.install() call
  switch (manifest.install.type) {
    case "npm":
      // Plugin install — runs through the existing Phase 34 Control Panel flow
      return Plugin.install({ name: manifest.install.spec })
    case "github":
      return ControlPanel.installFromGit({ url: manifest.install.spec })
    case "remote":
      return MCP.add(manifest.id, { type: "remote", url: manifest.install.url })
    case "manifest":
      // Custom MCP server manifest — already-validated shape
      return MCP.add(manifest.id, manifest.install.manifest)
  }
}
```

Reuses everything from Phases 33–34 (native MCP CLI + Control Panel
import). No new install paths — just a marketplace wrapper around the
existing primitives.

### 2. Signature verification

Add `packages/librecode/src/util/sigstore-verify.ts` — verifies the
sigstore signature on the downloaded manifest against the public key
published at `mcpappfoundry.app/.well-known/sigstore-key.pub`. Cache
the key with a 24h TTL.

If verification fails, the install dialog refuses with a clear error:

> Refusing to install: signature mismatch. Either the manifest was
> tampered with or your local clock is wrong. Open
> https://mcpappfoundry.app/app/<id> in a browser to verify.

### 3. Search & browse UX

The current dialog (243 lines) does keyword search. Adds needed:

- **Featured carousel** at the top — handpicked apps. Editor's-pick rotation.
- **Category filters** — `coding`, `data`, `productivity`, `chat`,
  `ops`, `creative`. Derived from app `capabilities`.
- **Sort dropdown** — Relevance / Most Installed / Highest Rated / Newest.
- **Detail view** — click an app → side panel with screenshots, README,
  changelog, install button, reviews. Currently the dialog is flat list.
- **Already installed indicator** — cross-reference with `MCP.list()` +
  `Plugin.list()` to mark installed apps.
- **Updates available** — when an installed app's `latest_version` >
  local version, surface in a sidebar badge.

### 4. Reviews & ratings

- Read-anyone (no auth needed).
- Write requires a LibreCode account (the same OAuth flow used by Phoenix
  - opncd accounts — gated, but no payment).
- Rate-limit: 1 review per app per user. Updatable.
- Flag-for-mod: any auth'd user can flag a review. Two flags → hidden
  pending mod review.

### 5. Publish flow

A CLI in the marketplace repo:

```bash
$ mcpappfoundry login
# OAuth via GitHub

$ mcpappfoundry init
# Generates a manifest.toml in the cwd

$ mcpappfoundry publish
# Validates manifest, computes sha256, signs with the user's local
# sigstore key (auto-generated on first publish), uploads to R2,
# inserts app_versions row, returns the public URL.

$ mcpappfoundry yank 1.2.0
# Marks that version as yanked (hidden from search; still installable
# by exact version pin).
```

Manifest format (TOML for human-edit-ability):

```toml
id = "multica"
version = "0.9.78"
name = "Multica"
description = "Self-hosted Linear/Jira alternative for issue tracking inside LibreCode"
author = "techtoboggan"
homepage = "https://multica.app"
repository = "https://github.com/multica-ai/multica"
capabilities = ["issue-tracking", "kanban", "mcp-app"]

[install]
type = "github"
spec = "https://github.com/multica-ai/multica#main:mcpapps/multica"
command = "bun run mcpapps/multica/src/index.ts"

[[screenshots]]
url = "https://mcpappfoundry.app/assets/multica/board-view.png"
caption = "Kanban board embedded as an MCP App"

[changelog]
"0.9.78" = "Initial publish"
```

---

## Phase 39c — Launch tier

**Week 1: seed the marketplace.**

Hand-publish the apps we already have:

- `multica` — our own MCP app (already at `mcpapps/multica/`)
- `superpowers` — the Anthropic skill collection (already in our curated git-repo list)
- `superpowers-chrome` — same
- `anthropic-skills` — same
- 2-3 reference plugins as examples for authors (e.g., a basic
  "echo MCP server", a "weather" example)

Each gets a screenshot + write-up. Initial discoverability problem solved
by having 5-10 quality entries on day 1.

**Week 2: open submissions.**

Announce on Hacker News + LibreCode's release notes. Open the publish
flow, manually review the first ~50 submissions, promote the verified
authors.

**Week 3: reviews + ratings live.**

Wait for the first 100+ installs to land, then turn on reviews so the
ranking signal is meaningful.

---

## Phase 39d — Followups (not in initial launch)

Listed here so they don't get forgotten:

- **Author tipping** — Stripe Connect link from author profile to
  enable optional tipping. No platform fee.
- **Bundles** — meta-apps that install several apps together
  (`@cohort/web-dev-bundle` installs prettier-lsp + tailwind-lsp +
  htmlhint + ...).
- **Workspace install state** — currently install is per-LibreCode-instance.
  Add `librecode.jsonc`-baked install state so `librecode mcp install
--from-workspace` re-installs everything when you check out a repo.
- **Telemetry-based ranking signal** — opt-in metric exporter on the
  app side (via the existing Phoenix pipeline) lets the marketplace
  compute "stability" / "responsiveness" scores. Strictly opt-in.
- **VS Code extension** — install LibreCode apps from a VSC sidebar.
  Reuses the marketplace API as-is.
- **Discoverability via embeddings** — when an app's description is too
  short for BM25 to rank well, embed it and use vector similarity. Worth
  doing once there are 500+ apps.

---

## Effort estimate

| Phase                       | Effort        | Notes                                                                                                                       |
| --------------------------- | ------------- | --------------------------------------------------------------------------------------------------------------------------- |
| 39a — Host service          | 2-3 weeks     | Wrangler boilerplate + D1 schema + 8 routes + sigstore verify. Most of the time is in moderation tooling + the publish CLI. |
| 39b — LibreCode integration | 1-2 weeks     | Real install execution + signature verify + featured/categories/sort UI + reviews. The scaffold absorbs most of the lift.   |
| 39c — Launch                | 1 week        | Seeding + announce + first-50 manual review.                                                                                |
| **Total**                   | **4-6 weeks** | One engineer, focused. Can parallelize 39a + 39b.                                                                           |

Risks:

- **Sigstore on Cloudflare Workers** — verify-side needs WebCrypto-only
  primitives. Sigstore's official JS lib uses Node `crypto`. Plan B: port
  the small subset of verify code to WebCrypto (~200 lines), or fall
  back to a simpler ed25519-signed-by-known-public-key scheme until
  sigstore-on-edge matures.
- **D1 search performance** — if the BM25 implementation in-Worker is
  slower than expected, fall back to a pre-tokenized inverted index in
  D1. Both paths are pure SQL.
- **Submission spam** — the first wave of public submissions will
  include name-squatting attempts (`librecode`, `chatgpt`, etc.).
  Reserved-name list at launch, manual approval until each author has
  one verified app.

---

## Open decisions

These need calls before 39a starts:

1. **Domain for the API.** `mcpappfoundry.app/api/v1` (current scaffold)
   vs `api.mcpappfoundry.app/v1` (cleaner CORS story, separate worker).
2. **Author authentication.** GitHub OAuth (matches the install spec)
   vs first-class accounts on mcpappfoundry. → **GitHub OAuth** —
   matches the LibreCode account flow already in v0.9.34.
3. **Free for everyone?** Yes for v1. Revisit when ranking signal needs
   anti-gaming (paid verification, etc.).
4. **What's "verified"?** Initially: author with ≥3 apps + zero takedowns
   in last 90 days. Make the bar visible on the author profile.
5. **License default for published apps.** Suggest MIT, allow any
   SPDX-recognized identifier, reject unknown / proprietary unless
   author opts into "private use only" gating.

---

## Where this lands in PLAN.md

Phase 39 (formerly tracked) → **Phase 41: Plugin Marketplace** in the
post-v0.9.81 roadmap. Move it ahead of the namespace migrations and
the BDD coverage push — once the marketplace is live the
user-acquisition story changes meaningfully.
