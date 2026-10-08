// Service worker: schedules the alarm and runs one tidy pass per tick.
// Order matters: group -> reap -> collapse -> sort, re-reading tabs between
// steps because each step changes the tab list.

import { loadBrain, loadConfig } from "./brain.js";
import {
  applyWanted,
  collapseIdle,
  ensureServiceGroups,
  sortAllWindows,
  wantedFromAssignments,
} from "./groups.js";
import { plan } from "./jev.js";
import {
  clearPulse,
  describeKept,
  isBackgroundChange,
  keepSet,
  loadPulse,
  notePulse,
  prunePulse,
} from "./keep.js";
import { isActive } from "./license.js";
import { error as logError, errorData, info, warn } from "./log.js";
import {
  clearSeen,
  findVictims,
  mergeVictims,
  reap,
  recordSeen,
  victimsFromIds,
} from "./reaper.js";

const ALARM = "jevtabtidy";
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
    logError("step.failed", { step: name, ...errorData(err) });
    return 0;
  }
}

/** Clear the "KEY" badge once a key is active. */
async function clearBadge() {
  await chrome.action.setBadgeText({ text: "" });
}

/** One full pass. Safe to call from anywhere; overlapping calls are dropped. */
export async function tidy() {
  if (running) return null;
  // No verified key = do nothing; the badge tells the user why.
  if (!(await isActive())) {
    warn("pass.skipped", { reason: "no active key" });
    await chrome.action.setBadgeText({ text: "KEY" });
    await chrome.action.setBadgeBackgroundColor({ color: "#b00020" });
    return null;
  }
  running = true;
  const started = Date.now();
  const status = { at: started, grouped: 0, closed: 0, collapsed: 0, sorted: 0 };
  try {
    const cfg = await loadConfig();
    const now = Date.now();
    await clearBadge();
    await recordSeen(await chrome.tabs.query({}), now, true);

    // One decision call per pass; uses the cached session, no handshake.
    // Never-touch list: the last N used tabs and tabs that change in the background.
    const allTabs = await chrome.tabs.query({});
    await prunePulse(allTabs);
    for (const problem of (await loadBrain()).problems) warn("brain.problem", { problem });
    const pulse = await loadPulse();
    const keep = keepSet(allTabs, cfg, pulse, now);
    info("pass.start", { tabs: allTabs.length, kept: keep.size, jev: Boolean(cfg.decideUrl) });

    const planned = await plan(
      cfg,
      allTabs,
      await chrome.tabGroups.query({}),
      now,
      keep,
    ).catch((err) => ({ via: "fallback", reason: err.message }));
    status.via = planned.via;
    status.reason = planned.reason;
    info("pass.decisions", { via: planned.via, reason: planned.reason ?? "" });
    const decision = planned.decision;

    status.grouped = await step(status, "group", async () => {
      const tabs = await chrome.tabs.query({});
      if (!decision) return ensureServiceGroups(tabs, cfg);
      return applyWanted(wantedFromAssignments(decision.groups, tabs));
    });

    status.closed = await step(status, "reap", async () => {
      const tabs = await chrome.tabs.query({});
      // Jev's picks, plus anything idle past the hard limit (searches, browser
      // pages after minutes; everything else after idleCloseHours) with no question asked.
      const hard = { ...cfg, staleAfterMin: cfg.idleCloseHours * 60 };
      const victims = decision
        ? mergeVictims(
            victimsFromIds(tabs, decision.close, cfg, decision.why, keep),
            findVictims(tabs, hard, now, keep),
          )
        : findVictims(tabs, cfg, now, keep);
      return reap(victims, cfg, now);
    });

    const tabs = await chrome.tabs.query({});
    info("pass.kept", describeKept(tabs, cfg, pulse, now, planned.askedIds ?? [], cfg.askAfterMin));
    status.collapsed = await step(status, "collapse", () =>
      collapseIdle(tabs, cfg, now),
    );
    status.sorted = await step(status, "sort", () => sortAllWindows(tabs));
  } catch (err) {
    // Config load failed: record it, keep the schedule alive.
    status.error = String(err?.message ?? err);
    logError("pass.failed", errorData(err));
  } finally {
    running = false;
    const { at, ...counts } = status;
    info("pass.end", { ms: Date.now() - started, ...counts });
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
  info("extension.installed");
  schedule();
  tidy();
});
chrome.runtime.onStartup.addListener(async () => {
  info("browser.startup");
  await clearSeen(); // tab ids from the last session mean nothing now
  await clearPulse();
  await schedule();
});

// A background tab whose title, icon or sound changes is "live": it is kept.
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (isBackgroundChange(tab, changeInfo)) notePulse(tabId, Date.now());
});

// Stamp new tabs the moment they open so the history can show when they were open.
chrome.tabs.onCreated.addListener((tab) => {
  recordSeen([tab], Date.now());
});

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
  if (area === "local" && changes.license) {
    info("license.changed", { state: changes.license.newValue?.state ?? "removed" });
    tidy();
  }
});
