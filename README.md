# Jevtabtidy

A Chrome extension that keeps your tabs tidy in the background. Every 15 minutes
it closes tabs you have finished with and groups the ones worth keeping. **Jev**
(TypeSafe's System One decision model) makes the call; simple local rules take
over if Jev is off or unreachable.

## Objective

Too many open tabs, and nobody wants to list sites by hand. You describe in plain
language what you keep and what you are done with (`policy` in `brain.yaml`). Jev
judges each idle tab against that. Anything you could lose stays safe by default.

## How a pass works

1. **Protect.** Never closed: pinned, grouped, playing sound, the active tab, the
   last N used tabs (`keepRecent`), and "live" tabs (title, icon or sound kept
   changing in the background, e.g. mail or chat; one per site).
2. **Ask Jev.** Each remaining tab idle for `askAfterMin` or more becomes one
   question: `close`, a category (Work, Reference, Communication, Media), or `keep`.
   Jev also sees your 5 most recent tabs as focus.
3. **Act only when sure.** Close at 75% confidence or more, group at 60% or more
   (both configurable). A category becomes a tab group only if at least
   `minGroupSize` tabs share it.
4. **Fallback.** If Jev is off or unreachable, local rules decide: service
   patterns (Jira, GitHub, ...) get grouped, forgotten pages (search results,
   remote desktop, New tab) and long-stale tabs close.
5. **Undo.** The last batch can be reopened from the popup. Closed URLs (last
   100) are listed on the history page.

## Configure the brain

Everything that decides behavior lives in [`brain.yaml`](brain.yaml), fully
commented. Three layers, later wins:

1. code defaults (`src/config.js`)
2. `brain.yaml`, or the copy you save on the Settings page
3. fields you change by hand in the Settings form

To change behavior (works for people and coding agents alike):

1. Edit `brain.yaml`, or edit it on the Settings page and press **Save YAML**.
2. If you edited the file, run `npm test` (it reports bad keys, types and ranges
   in plain sentences) and reload the extension at `chrome://extensions`.
3. Check **Settings -> Activity log** for `brain.problem`, `pass.kept` and
   `tab.close` lines.

A broken file never breaks the extension; it falls back to safe values.

## Install

1. Open `chrome://extensions`, enable Developer mode.
2. **Load unpacked** and pick this folder.
3. Open the popup, paste your TypeSafe API key, press **Activate**.

## Privacy

- The key is stored in the browser and sent only to `api.typesafe.ai` as a Bearer
  token. It is never written to the activity log.
- Nothing about your tabs is sent until you tick the consent box in the popup.
- Jev receives each asked tab's title and address (origin and path only; query
  string, fragment and credentials are removed), plus your recent tabs as focus.
  Never page contents. See [PRIVACY.md](PRIVACY.md).
- Logs record hosts and reasons only.

## Layout

| Path | Role |
|---|---|
| `src/background.js` | alarm, the tidy pass, logging |
| `src/jev.js` | build questions, parse answers, plan closes and groups |
| `src/keep.js` | recent and live tab protection |
| `src/rules.js`, `src/groups.js` | local fallback rules, grouping |
| `src/reaper.js` | close, history, undo |
| `src/brain.js`, `src/config.js` | settings layers, validation |
| `src/license.js` | key check and session |
| `popup/`, `options/`, `history/` | UI |
