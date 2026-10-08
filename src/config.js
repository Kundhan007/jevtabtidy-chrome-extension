// Config: defaults, sanitising and chrome.storage persistence.
// All thresholds are minutes. Patterns are substrings of "hostname + pathname"
// (see rules.js), e.g. "google.com/search" or "jira.".

export const COLORS = [
  "grey", "blue", "red", "yellow", "green", "pink", "purple", "cyan", "orange",
];

// Jev = TypeSafe AI's System One decision model (docs.typesafe.ai/api).
export const JEV_URL = "https://api.typesafe.ai/v1/systemone";
export const JEV_MODEL = "jev-latest";

export const DEFAULTS = {
  // Low-priority housekeeping: every 15 min is plenty. Clamped to >= 5 so it
  // can never become a steady load on the browser.
  intervalMinutes: 15,
  // The N most recently used tabs are never closed.
  keepRecent: 5,
  // Jev groups a category only when at least this many tabs share it.
  minGroupSize: 5,
  // With Jev on: ungrouped tabs untouched this long close without asking.
  idleCloseHours: 24,
  // A tab that changed in the background within this window counts as live.
  liveWindowHours: 24,
  // true = only log what would be closed. Flip to false once the log looks right.
  dryRun: true,
  // Collapse a group when every tab in it has been idle this long.
  collapseAfterMin: 10,
  // Close ungrouped, unrecognised tabs idle this long.
  staleAfterMin: 60,
  // Close "forgotten" tabs (search results, remote desktop) idle this long.
  forgottenAfterMin: 15,
  // Where the key is checked once on Activate (a tiny probe call).
  verifyUrl: JEV_URL,
  // Jev's decision endpoint. If it is unreachable the local rules below decide.
  decideUrl: JEV_URL,
  // Plain-language guidance sent to Jev with every decision call. This is how
  // you steer it without listing sites; edit it in Settings.
  policy:
    "Close tabs the user has clearly finished with or forgot: stale search " +
    "results, idle remote-desktop pages, one-off lookups. Keep anything related " +
    "to the user's most recent tabs (see focus) and reference material they " +
    "are likely to return to. When unsure, keep the tab.",
  // Local fallback rules, used only when Jev is off or unreachable. Matching
  // ungrouped tabs are pulled into a group named after the service. The
  // extension never closes a tab that sits in a group, so these groups never
  // disappear on their own.
  services: [
    { name: "Bitbucket", color: "cyan", patterns: ["bitbucket.org"] },
    {
      name: "Confluence",
      color: "purple",
      patterns: ["atlassian.net/wiki", "confluence."],
    },
    { name: "GitHub", color: "grey", patterns: ["github.com"] },
    {
      name: "Jira",
      color: "blue",
      patterns: ["atlassian.net/jira", "atlassian.net/browse", "jira."],
    },
  ],
  // Tabs people forget to close. Closed after forgottenAfterMin of idleness.
  forgotten: [
    "google.com/search",
    "bing.com/search",
    "duckduckgo.com",
    "search.brave.com",
    "remotedesktop.google.com",
    "anydesk.com",
    "teamviewer.com",
    "rdweb",
  ],
};

const STORE_KEY = "config";

/** Clamp to [min, max]; fall back when the value is not a finite number. */
function num(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function strings(value, fallback) {
  if (!Array.isArray(value)) return fallback;
  return value.map((s) => String(s).trim()).filter(Boolean);
}

/** Trimmed https URL, or "" for anything else (http, junk, empty). */
function httpsUrl(value) {
  const text = String(value ?? "").trim();
  try {
    return new URL(text).protocol === "https:" ? text : "";
  } catch {
    return "";
  }
}

function services(value, fallback) {
  if (!Array.isArray(value)) return fallback;
  const out = [];
  for (const s of value) {
    const name = String(s?.name ?? "").trim();
    const patterns = strings(s?.patterns, []);
    if (!name || patterns.length === 0) continue;
    const color = COLORS.includes(s.color) ? s.color : "grey";
    out.push({ name, color, patterns });
  }
  return out;
}

/** Turn whatever is in storage (or the options form) into a safe config. */
export function sanitize(raw = {}) {
  const d = DEFAULTS;
  return {
    intervalMinutes: num(raw.intervalMinutes, d.intervalMinutes, 5, 120),
    keepRecent: num(raw.keepRecent, d.keepRecent, 1, 50),
    minGroupSize: num(raw.minGroupSize, d.minGroupSize, 1, 50),
    idleCloseHours: num(raw.idleCloseHours, d.idleCloseHours, 1, 720),
    liveWindowHours: num(raw.liveWindowHours, d.liveWindowHours, 1, 168),
    dryRun: raw.dryRun === undefined ? d.dryRun : Boolean(raw.dryRun),
    collapseAfterMin: num(raw.collapseAfterMin, d.collapseAfterMin, 1, 1440),
    staleAfterMin: num(raw.staleAfterMin, d.staleAfterMin, 5, 10080),
    forgottenAfterMin: num(raw.forgottenAfterMin, d.forgottenAfterMin, 1, 1440),
    // Empty or invalid falls back to the default, so a blank saved box cannot switch Jev off.
    verifyUrl: httpsUrl(raw.verifyUrl) || d.verifyUrl,
    decideUrl: httpsUrl(raw.decideUrl) || d.decideUrl,
    policy: String(raw.policy ?? "").trim().slice(0, 2000) || d.policy,
    services: services(raw.services, d.services),
    forgotten: strings(raw.forgotten, d.forgotten),
  };
}

export async function loadConfig() {
  const stored = await chrome.storage.sync.get(STORE_KEY);
  return sanitize(stored[STORE_KEY]);
}

export async function saveConfig(cfg) {
  const clean = sanitize(cfg);
  await chrome.storage.sync.set({ [STORE_KEY]: clean });
  return clean;
}

export async function resetConfig() {
  await chrome.storage.sync.remove(STORE_KEY);
  return sanitize();
}
