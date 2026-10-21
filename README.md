# browser-tweaks

A personal collection of small browser tweaks: userscripts that add features to or fix
annoyances in web applications, and possibly custom style sheets and image resources later.
Each script is self-contained and can be installed on its own.

## Installation

The userscripts run in the [Tampermonkey](https://www.tampermonkey.net/) browser extension.
Install it for your browser from [tampermonkey.net](https://www.tampermonkey.net/) first.

Then click a script's **Install** link below. Tampermonkey recognizes the `.user.js` file and
opens its install page. Installed scripts update themselves from this repository whenever their
`@version` is raised.

The *Install* links point at the raw files (absolute URLs): a relative link in this README would
open GitHub's file viewer instead, which Tampermonkey does not pick up.

## User scripts

| Script | Description | Install |
|---|---|---|
| Bitbucket Dashboard PR Actions | Adds an *Actions* column to the open pull-request lists on the dashboard ("Your work") of a BitBucket data-center instance, with the PR page's *Needs work* / *Approve* buttons plus *Merge* (using the repository's default strategy and your remembered "delete source branch" choice) and *Decline*, so you don't have to open each PR. English and German. | [Install](https://raw.githubusercontent.com/Robin479/browser-tweaks/main/bitbucket-dashboard-actions.user.js) |

## Running a script on your own host

Some scripts for self-hosted applications can't know your server's address. They match a common
host name instead (see notes below) and check that the page really belongs to the application
before doing anything. If your installation lives under a different host name, add it once in
Tampermonkey: *Dashboard* → the script → *Settings* → *Includes/Excludes* → **User matches**
(e.g. `https://git.example.com/dashboard*`). These settings are kept across script updates.

### Notes per script

- **Bitbucket Dashboard PR Actions** runs on `https://bitbucket.<anything>/dashboard` (e.g.
  `https://bitbucket.example.com/dashboard`).

## Development

Raise a script's `@version` with every change, or Tampermonkey won't update it. A git hook in
`.githooks/` checks this on `git push` to `main` and offers to commit a patch-version bump.
Enable it once per clone:

```sh
git config core.hooksPath .githooks
```

## License

[Apache License 2.0](LICENSE)
