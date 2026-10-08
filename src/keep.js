// Keep list: the tabs that must survive a pass, whatever else says "close".
//   recent  the N most recently used tabs, plus the tab you are on
//   live    tabs that change in the background (Gmail unread count, WhatsApp,
//           a playing video); one per site, the most recently used
// "Live" is inferred from tab events only: Chrome says when a background tab's
// title, icon or sound changes, and a static page (search, article) never does.
//
// How it is used: background.js builds this set once per pass, jev.js never
// asks about these tabs, and reaper.js refuses to close them even if Jev or a
// rule picks one. Pulses are counted from tabs.onUpdated and stored per tab id.
// ponytail: a page that changes inside without touching title/icon (a dashboard)
// looks static. Group such tabs, or add a content script if that ever matters.

import { NONE, hostPath } from "./rules.js";

const PULSE_KEY = "pulse";
const WRITE_GAP_MS = 60_000; // one pulse per tab per minute, never a storage storm
const MIN_PULSES = 2; // load-time title/icon noise is a burst; real updates repeat

const lastWrite = new Map(); // tabId -> ms of its last stored pulse

/** The n most recently used tabs (any window) plus every active tab. */
export function recentIds(tabs, n) {
  const byUse = [...tabs].sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0));
  const ids = new Set(byUse.slice(0, n).map((t) => t.id));
  for (const tab of tabs) if (tab.active) ids.add(tab.id);
  return ids;
}

/** "mail.google.com", or "localhost:9090" so ports stay distinct sites. */
export function siteOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return hostPath(url || "");
  }
}

/**
 * Tabs that changed in the background within the window. When several tabs of
 * one site are live (three YouTube tabs), only the most recently used survives;
 * the others fall back to the normal rules.
 */
export function liveIds(tabs, pulse, now, windowHours) {
  const since = now - windowHours * 3_600_000;
  const best = new Map(); // site -> newest live tab
  for (const tab of tabs) {
    const p = pulse[tab.id];
    if (!p || p.n < MIN_PULSES || p.last < since) continue;
    const site = siteOf(tab.url || "");
    const current = best.get(site);
    if (!current || (tab.lastAccessed ?? 0) > (current.lastAccessed ?? 0)) best.set(site, tab);
  }
  return new Set([...best.values()].map((t) => t.id));
}

/** Everything protected this pass. */
export function keepSet(tabs, cfg, pulse, now) {
  const keep = recentIds(tabs, cfg.keepRecent);
  for (const id of liveIds(tabs, pulse, now, cfg.liveWindowHours)) keep.add(id);
  return keep;
}

/**
 * Why each open tab is still open, as counts. Each tab lands in the first bucket
 * that applies: pinned, grouped, playing, recent, live, fresh (used within
 * askAfterMin), judged (Jev saw it and kept it) or other (non-web pages, past
 * the per-call cap).
 */
export function describeKept(tabs, cfg, pulse, now, askedIds, askAfterMin) {
  const recent = recentIds(tabs, cfg.keepRecent);
  const live = liveIds(tabs, pulse, now, cfg.liveWindowHours);
  const asked = new Set(askedIds);
  const counts = { total: tabs.length, pinned: 0, grouped: 0, playing: 0, recent: 0, live: 0, fresh: 0, judged: 0, other: 0 };
  for (const tab of tabs) {
    const idleMin = (now - (tab.lastAccessed ?? now)) / 60_000;
    if (tab.pinned) counts.pinned += 1;
    else if (tab.groupId !== NONE) counts.grouped += 1;
    else if (tab.audible) counts.playing += 1;
    else if (recent.has(tab.id)) counts.recent += 1;
    else if (live.has(tab.id)) counts.live += 1;
    else if (idleMin < askAfterMin) counts.fresh += 1;
    else if (asked.has(tab.id)) counts.judged += 1;
    else counts.other += 1;
  }
  return counts;
}

/** Is this tabs.onUpdated event a background change worth counting? */
export function isBackgroundChange(tab, changeInfo) {
  if (tab.active || tab.status === "loading") return false;
  return (
    changeInfo.title !== undefined ||
    changeInfo.favIconUrl !== undefined ||
    changeInfo.audible === true
  );
}

export async function loadPulse() {
  return (await chrome.storage.local.get(PULSE_KEY))[PULSE_KEY] ?? {};
}

/** Count one background change for a tab. Throttled to one per minute. */
export async function notePulse(tabId, now) {
  if (now - (lastWrite.get(tabId) ?? 0) < WRITE_GAP_MS) return;
  lastWrite.set(tabId, now);
  const pulse = await loadPulse();
  const p = pulse[tabId];
  pulse[tabId] = p ? { first: p.first, last: now, n: p.n + 1 } : { first: now, last: now, n: 1 };
  await chrome.storage.local.set({ [PULSE_KEY]: pulse });
}

/** Forget tabs that no longer exist. */
export async function prunePulse(tabs) {
  const open = new Set(tabs.map((t) => String(t.id)));
  const pulse = await loadPulse();
  const kept = Object.fromEntries(Object.entries(pulse).filter(([id]) => open.has(id)));
  if (Object.keys(kept).length !== Object.keys(pulse).length) {
    await chrome.storage.local.set({ [PULSE_KEY]: kept });
  }
}

/** Tab ids restart each browser session, so old pulses mean nothing. */
export async function clearPulse() {
  lastWrite.clear();
  await chrome.storage.local.remove(PULSE_KEY);
}
