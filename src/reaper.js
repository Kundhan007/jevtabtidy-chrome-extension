// Reaper: decides which tabs to close and records every closure.
// Only ever touches UNGROUPED tabs, so work groups are never emptied.

import {
  NONE,
  classify,
  describe,
  idleMinutes,
  isProtected,
} from "./rules.js";

const LOG_KEY = "closedLog";
const LOG_MAX = 200;

/**
 * Pure: pick the tabs that should be closed.
 *   forgotten tabs close after cfg.forgottenAfterMin
 *   other tabs close after cfg.staleAfterMin
 *   grouped, pinned, active, audible, service and skipped tabs never close
 */
export function findVictims(tabs, cfg, now) {
  const victims = [];
  for (const tab of tabs) {
    if (tab.groupId !== NONE) continue;
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
export function victimsFromIds(tabs, ids, cfg, why = {}) {
  const picked = new Set(ids);
  const victims = [];
  for (const tab of tabs) {
    if (!picked.has(tab.id) || tab.groupId !== NONE || isProtected(tab)) continue;
    const { kind } = classify(tab, cfg);
    if (kind === "skip" || kind === "service") continue;
    victims.push({ tab, reason: why[tab.id] ? `jev: ${why[tab.id]}` : `jev (${kind})` });
  }
  return victims;
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

  await appendLog(
    victims.map(({ tab, reason }) => ({
      at: now,
      title: tab.title || "",
      url: tab.url || "",
      reason,
      dryRun: cfg.dryRun,
    })),
  );

  if (cfg.dryRun) {
    for (const { tab } of victims) console.log("[dry-run] would close", describe(tab, now));
    return victims.length;
  }

  // tabs.remove ignores ids that vanished meanwhile only per call, so remove
  // one at a time and keep going if the user closed a tab first.
  let closed = 0;
  for (const { tab } of victims) {
    try {
      await chrome.tabs.remove(tab.id);
      closed += 1;
    } catch {
      // Tab already gone.
    }
  }
  return closed;
}
