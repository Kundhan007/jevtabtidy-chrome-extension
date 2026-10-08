// Service worker: schedules the alarm and runs one tidy pass per tick.
// Order matters: group -> reap -> collapse -> sort, re-reading tabs between
// steps because each step changes the tab list.

import { loadConfig } from "./config.js";
import { collapseIdle, ensureServiceGroups, sortAllWindows } from "./groups.js";
import { isActive } from "./license.js";
import { findVictims, reap } from "./reaper.js";

const ALARM = "tabtidy";
const STATUS_KEY = "lastRun";

// The worker can be woken by an alarm and a click at once; run one pass only.
let running = false;

/**
 * Run one step; a failure is recorded on `status.error` and returns 0 so the
 * remaining steps still run (e.g. a grouping error must not block collapsing).
 */
async function step(status, name, fn) {
  try {
    return await fn();
  } catch (err) {
    status.error = `${name}: ${String(err?.message ?? err)}`;
    console.error(`tabtidy ${name} failed`, err);
    return 0;
  }
}

/** Toolbar badge: "DRY" while nothing is really being closed, else empty. */
async function updateBadge(cfg) {
  await chrome.action.setBadgeText({ text: cfg.dryRun ? "DRY" : "" });
  await chrome.action.setBadgeBackgroundColor({ color: "#b26a00" });
}

/** One full pass. Safe to call from anywhere; overlapping calls are dropped. */
export async function tidy() {
  if (running) return null;
  // No verified key = do nothing; the badge tells the user why.
  if (!(await isActive())) {
    await chrome.action.setBadgeText({ text: "KEY" });
    await chrome.action.setBadgeBackgroundColor({ color: "#b00020" });
    return null;
  }
  running = true;
  const status = { at: Date.now(), grouped: 0, closed: 0, collapsed: 0, sorted: 0 };
  try {
    const cfg = await loadConfig();
    const now = Date.now();
    status.dryRun = cfg.dryRun;
    await updateBadge(cfg);

    status.grouped = await step(status, "group", async () =>
      ensureServiceGroups(await chrome.tabs.query({}), cfg),
    );

    status.closed = await step(status, "reap", async () => {
      const victims = findVictims(await chrome.tabs.query({}), cfg, now);
      return reap(victims, cfg, now);
    });

    const tabs = await chrome.tabs.query({});
    status.collapsed = await step(status, "collapse", () =>
      collapseIdle(tabs, cfg, now),
    );
    status.sorted = await step(status, "sort", () => sortAllWindows(tabs));
  } catch (err) {
    // Config load failed: record it, keep the schedule alive.
    status.error = String(err?.message ?? err);
    console.error("tabtidy pass failed", err);
  } finally {
    running = false;
    await chrome.storage.local.set({ [STATUS_KEY]: status });
  }
  return status;
}

/** (Re)create the repeating alarm from the stored interval. */
async function schedule() {
  const { intervalMinutes } = await loadConfig();
  await chrome.alarms.clear(ALARM);
  await chrome.alarms.create(ALARM, {
    delayInMinutes: 1,
    periodInMinutes: intervalMinutes,
  });
}

// On install also run once, which shows the "KEY" badge until a key is entered.
chrome.runtime.onInstalled.addListener(() => {
  schedule();
  tidy();
});
chrome.runtime.onStartup.addListener(schedule);

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM) tidy();
});

// Popup / options "Tidy now" button.
chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg?.type === "tidy-now") {
    tidy().then(reply);
    return true; // keep the channel open for the async reply
  }
  return false;
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "sync" && changes.config) schedule();
  // Key entered, verified or removed: start (or stop) straight away.
  if (area === "local" && changes.license) tidy();
});
