# Bitbucket Dashboard PR Actions — working notes

Script: [`../bitbucket-dashboard-actions.user.js`](../bitbucket-dashboard-actions.user.js)
Status (2026-10-21): v1.0.1, syntax-checked; **not yet verified end-to-end in the
browser** — the user tests manually and reports back.

## Goal

On the Bitbucket DC dashboard (`/dashboard`, "Your work"), add an *Actions* column to the open
PR lists so PRs can be reviewed/merged without opening each one:

- **Needs work** / **Approve** — the PR page's reviewer-status button pair (toggle: clicking the
  active one resets to `UNAPPROVED`). Hidden (`visibility: hidden`, space kept) on own PRs.
- **Merge** — uses the same defaults the PR page's merge dialog would (see below). Disabled
  when not mergeable, preceded by an orange "vetoes" button (warning icon + count) whose
  tooltip/click lists the blocking merge checks. Confirmation via `confirm()`.
- **Decline** — rightmost; icon `remove`, colour "danger" (analogue of needs-work/warning).
  Guarded by **two** `confirm()` dialogs (user requirement).

Not in scope: the "Recently closed pull requests" section.

## Dashboard DOM (from a rendered-HTML snapshot)

```
section#content > #dashboard-container > .main-panel
  div.dashboard-pull-request-table.main-section.<section>      <section> ∈
    h2.dashboard-section-title                                   reviewing-pull-requests  ("Pull requests to review")
    table[aria-label]                                            created-pull-requests    ("Your pull requests")
      thead > tr > th.avatar-column … th.builds-column          closed-pull-requests     (skipped)
      tbody > tr.pull-request-row[data-pullrequestid]
        td.summary-column .pr-summary .title > a[href="/projects/P/repos/R/pull-requests/N/overview"]
    button.show-more  ("Show more pull requests" – appends rows; handled by the MutationObserver)
```

- The page is React-rendered; the script uses a `MutationObserver` (rAF-throttled) and
  re-adds its `td.tm-pr-actions` cell to any row lacking it.
- Lesson learned: a comma-separated selector list must be built per alternative
  (`A tbody tr, B tbody tr`); `${'A, B'} tbody tr` silently matched section `A` itself.
- Current user: `meta[name="ajs-remote-user"]` (username; slug taken from the PR participants).

## REST calls (from HAR captures of approving and merging a PR)

Browser requests send `Content-Type: application/json`, `X-Requested-With: XMLHttpRequest`;
the script additionally sends `X-Atlassian-Token: no-check`. Same-origin cookies suffice.

| Purpose | Request |
|---|---|
| PR details (version, refs, reviewers, participants) | `GET /rest/api/latest/projects/{P}/repos/{R}/pull-requests/{id}` |
| Mergeability | `GET …/pull-requests/{id}/merge` → `{canMerge, conflicted, outcome, vetoes:[{summaryMessage, detailedMessage}]}` (UI uses `/rest/ui/latest/…/merge`, same shape) |
| Approve / needs work / reset | `PUT …/pull-requests/{id}/participants/{userSlug}?version={v}` body `{"status":"APPROVED"\|"NEEDS_WORK"\|"UNAPPROVED","lastReviewedCommit":fromRef.latestCommit}` |
| Decline | `POST …/pull-requests/{id}/decline?version={v}` body `{}` (standard REST API; not captured in HAR) |
| Repo merge settings | `GET /rest/api/latest/projects/{P}/repos/{R}/settings/pull-requests` → `mergeConfig.defaultStrategy` |
| "Delete source branch" default | `GET /rest/branch-utils/latest/projects/{P}/repos/{R}/delete-after-merge` → `{"enabled":true}` — **stored server-side** (per user/repo) |
| Commit message | `GET …/pull-requests/{id}/commit-message-suggestion` → `{title, body}` |
| Merge | `POST …/pull-requests/{id}/merge?version={v}` body `{"autoSubject":false,"message":"<title>\n\n<body>","autoMerge":false,"bypassMergeQueue":false}` — no `strategyId` ⇒ repo default strategy |
| Delete branch after merge | `POST /rest/pull-request-cleanup/latest/projects/{P}/repos/{R}/pull-requests/{id}` body `{"deleteSourceRef":true,"retargetDependents":true}` (only if delete-after-merge is enabled) |

Per row the script loads PR details + merge status (max 4 concurrent requests); repo
settings are cached per repo. After any action the row is re-rendered from fresh data.

## Styling (from the PR page snapshot + its CSS batch)

PR page markup of the status buttons:

```html
<div class="reviewer-status-buttons reviewing"><div class="reviewer-status-buttons-container">
  <button class="status-button needs-work css-47uhjk" data-testid="toggle-needs-work" aria-label="Request changes: …">
    <span class="css-bwxjrz"><span class="aui-icon aui-icon-small aui-iconfont-needs-work"></span></span></button>
  <button class="status-button approve css-47uhjk" data-testid="toggle-approve-pull-request" aria-label="Approve: …">…aui-iconfont-approve…</button>
```

- The `css-*` classes are Atlaskit/emotion styles injected at runtime (not in saved HTML,
  probably absent on the dashboard). The script therefore re-creates the Atlaskit default
  button from design tokens (`--ds-background-neutral[-hovered|-pressed]`, `--ds-text-subtle`,
  `--ds-background-disabled`, …) under its own `tm-*` classes.
- Copied Bitbucket rules: needs-work icon `--ds-background-warning-bold`, selected bg
  warning-bold + inverse icon `--ds-icon-warning-inverse`; approve icon/selected
  `--ds-background-success-bold`, inverse icon `--ds-surface-sunken`; pair joined
  (needs-work right radii 0, approve left radii 0 + 2px gap). Decline: icon
  `--ds-background-danger-bold`. Vetoes button: `--ds-background-warning-bold[-hovered|-pressed]`,
  text `--ds-text-warning-inverse`, SVG warning triangle copied from the PR page.
- AUI icon font is loaded on the dashboard (`aui-iconfont-check` present there).

## Decisions

- Hosting: the script was first hosted in a login-protected Bitbucket repo. Tampermonkey's
  background download carries no Bitbucket session (it got the login redirect), so the install
  link fell back to showing the raw file and updates could not work. Hence the public GitHub repo.
- Host targeting: no fixed host in the public repo. `@include /^https:\/\/bitbucket\.[^\/]+\/dashboard/`
  plus a runtime guard `isBitbucket()` (`meta[name="application-name"][content="Bitbucket"]`,
  present on Bitbucket DC pages) before `start()`. Other host names → Tampermonkey "User matches"
  (README). `bitbucket.org` (Cloud) also matches the pattern; there the DC-specific row
  selectors simply find nothing.
- Localization: `TEXTS` table (`en`, `de`) chosen by `<html lang>` (Bitbucket renders the user's
  resolved locale there, e.g. `de`); unknown languages fall back to English. Bitbucket's own
  translations live in its JS bundles (no usable runtime API), so the script has its own.
  Server-provided texts (merge veto messages, strategy name) arrive already localized.
  German terms taken from Bitbucket's German UI: "Pull-Anfrage", "Mergen" (merge button),
  "Pull-Anfrage mergen" (dialog title), "nach Mergen löschen" (delete-source checkbox),
  "Ablehnen" (decline, in the "more actions" menu), "genehmigt" (approved), "Sie" form.
  Status-button labels copied verbatim from the German PR page: "Änderungen anfordern: Für diese
  Pull-Anfrage sollte noch kein Merge durchgeführt werden", "Genehmigen: Diese Pull-Anfrage kann
  nun zusammengeführt werden". Vetoes button there: "Klicken, um 2 Vorgänge anzuzeigen, die den
  Merge verhindern" (EN: "Click to view 3 merge blocking issues").

- Merge strategy: the repo default (no `strategyId`). Whether Bitbucket remembers a user's
  last-picked strategy (likely browser localStorage) is **unknown** — HAR had no JS bundles.
  Irrelevant for repos with a single enabled strategy (e.g. only `no-ff`).
- `retargetDependents: true` as the dialog sent it.
- Alignment: when a PR is mergeable, an invisible vetoes placeholder (`.tm-hidden`) keeps the
  Merge buttons in one column; `.tm-vetoes` has `min-width: 46px` like the PR page's button.
- Reorder guard (v1.0.1): Bitbucket occasionally reloads the lists and re-sorts them (the
  dashboard requests `order=participant_status`, so freshly approved PRs move down). Trigger
  unknown (suspected: refetch on window focus, e.g. after `confirm()`); a HAR of an idle
  dashboard would tell. The script does not fight the reorder; instead, whenever a mutation
  removes a `tr.pull-request-row` (a move = removal + insertion) or a row is reused for another
  PR (cell carries `data-pr`, re-rendered on mismatch), all action buttons are disabled for
  `REORDER_GUARD_MS` (1 s; `html.tm-guarded`, plus a check in the click handler).
  Rejected: intercepting Bitbucket's list request to keep the old order (fragile).
- Approving a PR where the user isn't a reviewer adds them as a participant (same as on the
  PR page).

## Open items / to verify in the browser

- Whether `aui-iconfont-remove` and `aui-iconfont-needs-work` glyphs render on the dashboard.
- Visual parity of the re-created buttons (light and dark theme).
- Possible: honour a remembered merge strategy, if the user finds its localStorage key.
