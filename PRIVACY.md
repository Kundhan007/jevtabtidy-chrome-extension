# Jevtabtidy privacy policy

Jevtabtidy tidies your browser tabs. To decide which idle tabs to close or group,
it asks Jev, a decision service run by TypeSafe.

## What is sent, and when

After you tick the consent box in the popup and activate your key, each tidy pass
sends to `https://api.typesafe.ai`:

- the title and address of tabs that have been idle for a while, and of your most
  recently used tabs (so Jev knows what you are working on);
- the names of your existing tab groups;
- the plain-language guidance from `brain.yaml`, and your API key as a Bearer token.

Before sending, the fragment, any embedded username or password, and query
parameters whose names look like secrets (token, key, auth, session, code, etc.)
are removed. Other query parameters, such as search terms, are sent. Page contents, cookies,
form data and passwords are never read or sent.

Nothing is sent before you agree. Without a key and consent, only local rules run
and no data leaves your browser.

## What is stored

Everything else stays in your browser (`chrome.storage`): your key, settings, the
last 100 closed tabs (for undo and history) and a short activity log (hosts and
reasons only, never keys). Removing the key in the popup deletes the key and your
consent. Uninstalling the extension deletes all of it.

## What we do not do

No analytics, no advertising, no selling or sharing of data, and no use of tab
data for anything except deciding what to tidy.

## TypeSafe

Data sent to TypeSafe is handled under TypeSafe's own terms and privacy policy.
Jevtabtidy is not operated by TypeSafe.

## Contact

Open an issue at https://github.com/Kundhan007/jevtabtidy-chrome-extension
