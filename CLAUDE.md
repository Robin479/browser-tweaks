# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working in this repository.

## Purpose

Personal, **public** collection of general browser tweaks: Tampermonkey userscripts
(`*.user.js`) for any web application; custom style sheets and image resources may be added
later. Not tied to a particular site — each script documents its own target.
GitHub repo `Robin479/browser-tweaks`, default branch `main`. Commits use the GitHub identity
(`Robin479`, noreply email) via the `includeIf` in `~/src/github.com/.gitconfig`.

## Public-repo rule

Everything here is world-readable. Do **not** add internal information of the user's employer
or any other private system: no internal host names, repo/project names, ticket or PR numbers,
user names, commit ids, API responses or other real data from captures. Scripts target hosts
generically instead (see Conventions). Use placeholders (`example.com`, `{id}`, …) in docs.

## Layout

- `<name>.user.js` — one userscript per file, in the repo root.
- `doc/<name>.md` — per-script working notes: reverse-engineered APIs/DOM, design decisions,
  open items. **Read the matching doc before changing a script**, and update it when
  something durable changes.
- `README.md` — user-facing: Tampermonkey link, a table of all scripts with install links, and
  per-script notes (e.g. which hosts a script matches).

## Conventions

- Install/update URL pattern: `https://raw.githubusercontent.com/Robin479/browser-tweaks/main/<path>`.
  Every script sets `@updateURL` and `@downloadURL` to its own raw URL, `@namespace` and
  `@homepageURL` to `https://github.com/Robin479/browser-tweaks`, and `@license Apache-2.0`.
- Scripts for self-hosted applications use a host pattern instead of a fixed host (Tampermonkey
  regex `@include`, e.g. `/^https:\/\/bitbucket\.[^\/]+\/dashboard/`) and start only after a
  runtime check that the page belongs to the application (e.g. a `meta` tag). Users with other
  host names add a Tampermonkey "User match"; the README explains this and lists each script's
  pattern under "Notes per script".
- No hardcoded UI text: user-visible strings go into a `TEXTS` table in the script (at least
  `en` and `de`, chosen by the page's `<html lang>`, English fallback), using the target
  application's own terminology in each language.
- Scripts must not contain user-specific values; derive e.g. the current user from the page.
- **Raise `@version`** in the script header with every user-visible change; Tampermonkey
  only installs updates when the version increases.
- New script → add a row to the README table (name, short description incl. the target
  application, absolute raw install link — relative links open GitHub's file viewer, not the raw
  file), a "Notes per script" entry if it matches hosts generically, and a `doc/` file.
- Plain browser JavaScript, no build step, no dependencies. `node --check <file>` is the
  only automated check available; real testing happens in the browser by the user.
- The user's global code-style rules (negation avoidance, natural-order comparisons,
  no repeated calls, indented empty lines) apply to JavaScript here too.

## Analysis inputs

Target applications are typically reverse-engineered from browser network captures (HAR) and
rendered-HTML snapshots the user saves. These contain session cookies and private data and must
**never** be added to this repo; ask the user for fresh captures when needed and record only
generic findings (endpoints with placeholders, DOM structure, CSS tokens) in `doc/`.
