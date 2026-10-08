// History page: nothing but closed URLs, each with the time it was open
// ("4:00 PM – 5:12 PM") and when it was last used. Newest closed first.
// Dry-run entries are skipped because those tabs were never closed.

import { getClosedLog } from "../src/reaper.js";

const $ = (id) => document.getElementById(id);

function sameDay(a, b) {
  return new Date(a).toDateString() === new Date(b).toDateString();
}

/** "4:00 PM" for today, "Oct 7, 4:00 PM" for earlier days, "?" if unknown. */
export function stamp(ts, now = Date.now()) {
  if (!ts) return "?";
  const date = new Date(ts);
  const time = date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (sameDay(ts, now)) return time;
  const day = date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return `${day}, ${time}`;
}

/** "4:00 PM – 5:12 PM" = first seen open until closed. */
export function openSpan(entry, now = Date.now()) {
  return `${stamp(entry.openedAt, now)} – ${stamp(entry.at, now)}`;
}

/** Full local date and time with seconds, shown on hover for precision. */
export function exact(ts) {
  return ts ? new Date(ts).toLocaleString() : "unknown";
}

/** Hover text: the exact open, closed and last-used moments. */
export function tooltip(entry) {
  return [
    `Opened: ${exact(entry.openedAt)}`,
    `Closed: ${exact(entry.at)}`,
    `Last used: ${exact(entry.lastAccessed)}`,
  ].join("\n");
}

function itemFor(entry, now) {
  const item = document.createElement("li");

  const link = document.createElement("a");
  link.href = entry.url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = entry.url;

  const meta = document.createElement("span");
  meta.className = "meta";
  meta.title = tooltip(entry);
  meta.textContent = `open ${openSpan(entry, now)} · last used ${stamp(entry.lastAccessed, now)}`;

  item.append(link, meta);
  return item;
}

/** Only entries that were really closed and have a URL to show. */
export function usable(entry) {
  return Boolean(entry && entry.url && !entry.dryRun);
}

/** Newest closed first, whatever order storage returned them in. */
export function newestFirst(entries) {
  return [...entries].sort((a, b) => (b.at ?? 0) - (a.at ?? 0));
}

/** A single non-link row for messages ("No closed tabs yet.", errors). */
function messageItem(text) {
  const item = document.createElement("li");
  item.className = "empty";
  item.textContent = text;
  return item;
}

async function render() {
  const now = Date.now();
  const list = $("urls");
  list.replaceChildren();

  let entries;
  try {
    entries = newestFirst((await getClosedLog()).filter(usable));
  } catch (err) {
    list.append(messageItem(`Could not load the history: ${err.message}`));
    return;
  }

  if (entries.length === 0) {
    list.append(messageItem("No closed tabs yet."));
    return;
  }
  for (const entry of entries) list.append(itemFor(entry, now));
}

// Stay current if a pass closes something while the page is open.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.closedLog) render();
});

await render();
