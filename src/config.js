// Config: the full list of settings, their defaults and their limits, plus
// sanitise(). Nothing here touches storage or files; brain.js layers
// brain.yaml and the Settings page on top of these defaults.
// Thresholds are minutes unless the name says hours. Patterns are substrings of
// "hostname + pathname" (see rules.js), e.g. "google.com/search" or "jira.".

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
  // Collapse a group when every tab in it has been idle this long.
  collapseAfterMin: 10,
  // Close ungrouped, unrecognised tabs idle this long (local fallback rules).
  staleAfterMin: 60,
  // Close "forgotten" tabs (search results, remote desktop) idle this long.
  forgottenAfterMin: 15,
  // Jev is asked only about tabs idle at least this long (fresher ones are left alone).
  askAfterMin: 15,
  // Most tabs asked about per call; the idlest go first.
  maxTabsPerCall: 40,
  // Jev must be at least this sure (0.5-1) before a tab is closed / grouped.
  closeConfidence: 0.75,
  groupConfidence: 0.6,
  // Jev model name. If Jev is unreachable the local rules below decide.
  model: JEV_MODEL,
  // Plain-language guidance sent to Jev with every decision call. This is how
  // you steer it without listing sites.
  policy:
    "Close tabs the user has clearly finished with or forgot: stale search " +
    "results, idle remote-desktop pages, one-off lookups. Keep anything related " +
    "to the user's most recent tabs (see focus) and reference material they " +
    "are likely to return to. When unsure, keep the tab.",
  // Broad buckets Jev sorts kept tabs into; "hint" tells it what belongs. "close"
  // and "keep" are reserved. An empty list means Jev only closes or keeps.
  categories: [
    { name: "Work", color: "blue", hint: "Issue trackers, code hosting, internal tools, docs for the user's job" },
    { name: "Reference", color: "grey", hint: "Documentation, articles, Q&A the user may come back to" },
    { name: "Communication", color: "green", hint: "Email, chat, calendar, meetings" },
    { name: "Media", color: "pink", hint: "Video, music, social, shopping, news" },
  ],
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

// Every numeric setting with its [min, max]. sanitise() clamps to these and
// brain.js reports a problem when brain.yaml goes outside them.
export const NUMBERS = {
  intervalMinutes: [5, 120],
  keepRecent: [1, 50],
  minGroupSize: [1, 50],
  idleCloseHours: [1, 720],
  liveWindowHours: [1, 168],
  collapseAfterMin: [1, 1440],
  staleAfterMin: [5, 10080],
  forgottenAfterMin: [1, 1440],
  askAfterMin: [1, 1440],
  maxTabsPerCall: [1, 200],
  closeConfidence: [0.5, 1],
  groupConfidence: [0.5, 1],
};

const RESERVED = ["close", "keep"];

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

/** Unique names, none of the reserved ones; a bad color becomes grey. */
function categories(value, fallback) {
  if (!Array.isArray(value)) return fallback;
  const seen = new Set();
  const out = [];
  for (const c of value) {
    const name = String(c?.name ?? "").trim().slice(0, 30);
    if (!name || RESERVED.includes(name.toLowerCase()) || seen.has(name)) continue;
    seen.add(name);
    const color = COLORS.includes(c.color) ? c.color : "grey";
    out.push({ name, color, hint: String(c?.hint ?? "").trim().slice(0, 200) });
  }
  return out;
}

/** Turn whatever is in a file, storage or the Settings form into a safe config. */
export function sanitize(raw = {}) {
  const d = DEFAULTS;
  const numbers = {};
  for (const [key, [min, max]] of Object.entries(NUMBERS)) {
    numbers[key] = num(raw[key], d[key], min, max);
  }
  return {
    ...numbers,
    model: String(raw.model ?? "").trim().slice(0, 60) || d.model,
    policy: String(raw.policy ?? "").trim().slice(0, 2000) || d.policy,
    categories: categories(raw.categories, d.categories),
    services: services(raw.services, d.services),
    forgotten: strings(raw.forgotten, d.forgotten),
  };
}
