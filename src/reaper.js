// Reaper: decides which tabs to close and records every closure.
// Only ever touches UNGROUPED tabs, so work groups are never emptied.

import { siteOf } from "./keep.js";
import { info, warn } from "./log.js";
import { NONE, classify, idleMinutes, isProtected } from "./rules.js";

const LOG_KEY = "closedLog";
const LOG_MAX = 100;

/**
 * Pure: pick the tabs that should be closed.
 *   forgotten tabs close after cfg.forgottenAfterMin
 *   other tabs close after cfg.staleAfterMin
 *   grouped, pinned, active, audible, service and skipped tabs never close
 */
export function findVictims(tabs, cfg, now, keep = new Set()) {
  const victims = [];
  for (const tab of tabs) {
    if (tab.groupId !== NONE || keep.has(tab.id)) continue;
    if (isProtected(tab)) continue;

    const { kind } = classify(tab, cfg);
    // A service tab that failed to group is left alone rather than closed.
    if (kind === "skip" || kind === "service") continue;

    const limit =
      kind === "forgotten" ? cfg.forgottenAfterMin : cfg.staleAfterMin;
    const idle = idleMinutes(tab, now);
    if (idle < limit) continue;

    victims.push({
      tab,
      reason: `${kind} idle ${Math.round(idle)}m >= ${limit}m`,
    });
  }
  return victims;
}

/**
 * Jev picked these tab ids; keep only the ones that are safe to close.
 * Same guard as findVictims: ungrouped, not pinned/active/audible, not a
 * work-service tab, not a non-web page.
 */
export function victimsFromIds(tabs, ids, cfg, why = {}, keep = new Set()) {
  const picked = new Set(ids);
  const victims = [];
  for (const tab of tabs) {
    if (!picked.has(tab.id) || tab.groupId !== NONE || isProtected(tab) || keep.has(tab.id)) continue;
    const { kind } = classify(tab, cfg);
    if (kind === "skip" || kind === "service") continue;
    victims.push({ tab, reason: why[tab.id] ? `jev: ${why[tab.id]}` : `jev (${kind})` });
  }
  return victims;
}

// Chrome never says when a tab was opened, so we note the first time we see it.
// Tab ids reset between browser sessions, so this map is cleared on startup.
const SEEN_KEY = "seen";

/** Pure: tabId -> first-seen time. New ids get `now`; `prune` drops closed ones. */
export function mergeSeen(seen, tabs, now, prune = false) {
  const next = prune ? {} : { ...seen };
  for (const tab of tabs) next[tab.id] = seen[tab.id] ?? now;
  return next;
}

async function loadSeen() {
  return (await chrome.storage.local.get(SEEN_KEY))[SEEN_KEY] ?? {};
}

export async function recordSeen(tabs, now, prune = false) {
  await chrome.storage.local.set({ [SEEN_KEY]: mergeSeen(await loadSeen(), tabs, now, prune) });
}

export async function clearSeen() {
  await chrome.storage.local.remove(SEEN_KEY);
}

/** Merge victim lists, first reason wins, one entry per tab. */
export function mergeVictims(...lists) {
  const seen = new Set();
  return lists.flat().filter(({ tab }) => !seen.has(tab.id) && seen.add(tab.id));
}

/** Append entries to the closed log, keeping only the newest LOG_MAX. */
async function appendLog(entries) {
  const stored = await chrome.storage.local.get(LOG_KEY);
  const log = [...entries, ...(stored[LOG_KEY] ?? [])].slice(0, LOG_MAX);
  await chrome.storage.local.set({ [LOG_KEY]: log });
}

export async function getClosedLog() {
  const stored = await chrome.storage.local.get(LOG_KEY);
  return stored[LOG_KEY] ?? [];
}

export async function clearClosedLog() {
  await chrome.storage.local.remove(LOG_KEY);
}

/** Pure: the entries closed together in the newest real (non-dry, not yet undone) pass. */
export function lastBatch(log) {
  const live = log.filter((e) => !e.dryRun && !e.undone && e.url);
  return live.length === 0 ? [] : live.filter((e) => e.at === live[0].at);
}

/**
 * Undo the newest pass: reopen what it closed, in the background, and mark the
 * entries undone so a second click cannot duplicate them. One level only.
 * Reopened pages are fresh loads and are not put back into their old group.
 */
export async function undoLast() {
  const log = await getClosedLog();
  const batch = lastBatch(log);
  for (const entry of batch) {
    await chrome.tabs.create({ url: entry.url, active: false });
    entry.undone = true;
  }
  if (batch.length > 0) await chrome.storage.local.set({ [LOG_KEY]: log });
  info("undo", { reopened: batch.length });
  return batch.length;
}

/**
 * Reopen a logged tab in the current window (background, not focused).
 * Pages come back fresh: form state and scroll position are not restored.
 */
export async function reopen(entry) {
  if (!entry?.url) return null;
  return chrome.tabs.create({ url: entry.url, active: false });
}

/** "3 forgotten, 1 other" style breakdown, handy for logs and tests. */
export function summarize(victims) {
  const counts = {};
  for (const { reason } of victims) {
    const kind = reason.split(" ")[0];
    counts[kind] = (counts[kind] ?? 0) + 1;
  }
  return Object.entries(counts)
    .map(([kind, n]) => `${n} ${kind}`)
    .join(", ");
}

/**
 * Log every victim, then close them unless cfg.dryRun is set.
 * Returns how many tabs were (or would have been) closed.
 */
export async function reap(victims, cfg, now = Date.now()) {
  if (victims.length === 0) return 0;

  const seen = await loadSeen();
  await appendLog(
    victims.map(({ tab, reason }) => ({
      at: now,
      openedAt: seen[tab.id] ?? null,
      lastAccessed: tab.lastAccessed ?? null,
      title: tab.title || "",
      url: tab.url || "",
      reason,
      dryRun: cfg.dryRun,
    })),
  );

  // One line per tab: host and reason only, never the full URL.
  const event = cfg.dryRun ? "tab.would_close" : "tab.close";
  for (const { tab, reason } of victims) {
    info(event, { host: siteOf(tab.url || ""), reason, idleMin: Math.round(idleMinutes(tab, now)) });
  }
  if (cfg.dryRun) return victims.length;

  // tabs.remove ignores ids that vanished meanwhile only per call, so remove
  // one at a time and keep going if the user closed a tab first.
  let closed = 0;
  for (const { tab } of victims) {
    try {
      await chrome.tabs.remove(tab.id);
      closed += 1;
    } catch {
      warn("tab.close_failed", { host: siteOf(tab.url || ""), why: "tab already gone" });
    }
  }
  return closed;
}
