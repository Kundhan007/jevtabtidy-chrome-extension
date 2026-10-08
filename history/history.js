// History page: every tab TabTidy closed (or would have, in dry run), by day.
// Reads the same closedLog the reaper writes; nothing is stored here.

import { clearClosedLog, getClosedLog, reopen } from "../src/reaper.js";

const $ = (id) => document.getElementById(id);

let entries = [];

/** "Thursday, Oct 8, 2026" – one heading per calendar day. */
function dayLabel(at) {
  return new Date(at).toLocaleDateString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function timeLabel(at) {
  return new Date(at).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function hostOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

/** Entries after the search box and dry-run checkbox are applied. */
function visible() {
  const needle = $("search").value.trim().toLowerCase();
  const showDry = $("showDry").checked;
  return entries.filter((e) => {
    if (e.dryRun && !showDry) return false;
    if (!needle) return true;
    return `${e.title} ${e.url} ${e.reason}`.toLowerCase().includes(needle);
  });
}

/** Group newest-first entries by day, keeping order. */
function groupByDay(list) {
  const days = new Map();
  for (const entry of list) {
    const key = dayLabel(entry.at);
    if (!days.has(key)) days.set(key, []);
    days.get(key).push(entry);
  }
  return days;
}

function rowFor(entry) {
  const row = document.createElement("tr");
  if (entry.dryRun) row.className = "dry";

  const time = row.insertCell();
  time.className = "time";
  time.textContent = timeLabel(entry.at) + (entry.dryRun ? " (dry)" : "");

  const tab = row.insertCell();
  const link = document.createElement("a");
  link.href = entry.url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = entry.title || entry.url || "(untitled)";
  const host = document.createElement("div");
  host.className = "host";
  host.textContent = hostOf(entry.url);
  tab.append(link, host);

  const why = row.insertCell();
  why.className = "reason";
  why.textContent = entry.reason;

  const action = row.insertCell();
  if (!entry.dryRun) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "Reopen";
    button.addEventListener("click", () => reopen(entry));
    action.append(button);
  }
  return row;
}

function render() {
  const list = visible();
  const root = $("days");
  root.replaceChildren();

  $("summary").textContent = `${list.length} shown of ${entries.length} logged (newest 200 kept).`;
  if (list.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "Nothing closed yet.";
    root.append(empty);
    return;
  }

  for (const [label, dayEntries] of groupByDay(list)) {
    const heading = document.createElement("h2");
    heading.textContent = `${label} (${dayEntries.length})`;
    const table = document.createElement("table");
    const body = table.createTBody();
    for (const entry of dayEntries) body.append(rowFor(entry));
    root.append(heading, table);
  }
}

/** RFC 4180-style quoting: wrap in quotes, double any inner quote. */
function csvCell(value) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

function toCsv(list) {
  const head = ["closed_at", "title", "url", "reason", "dry_run"];
  const rows = list.map((e) =>
    [new Date(e.at).toISOString(), e.title, e.url, e.reason, e.dryRun].map(csvCell).join(","),
  );
  return [head.join(","), ...rows].join("\n");
}

function downloadCsv() {
  const blob = new Blob([toCsv(visible())], { type: "text/csv" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `tabtidy-closed-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}

$("search").addEventListener("input", render);
$("showDry").addEventListener("change", render);
$("csv").addEventListener("click", downloadCsv);
$("clear").addEventListener("click", async () => {
  await clearClosedLog();
  entries = [];
  render();
});

// Stay current if a pass runs while the page is open.
chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area === "local" && changes.closedLog) {
    entries = await getClosedLog();
    render();
  }
});

entries = await getClosedLog();
$("showDry").checked = entries.every((e) => e.dryRun); // first-day users only have dry entries
render();
