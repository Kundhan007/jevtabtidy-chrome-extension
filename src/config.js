// Config: defaults, sanitising and chrome.storage persistence.
// All thresholds are minutes. Patterns are substrings of "hostname + pathname"
// (see rules.js), e.g. "google.com/search" or "jira.".

export const COLORS = [
  "grey", "blue", "red", "yellow", "green", "pink", "purple", "cyan", "orange",
];

export const DEFAULTS = {
  // How often the alarm fires. Chrome allows >= 0.5, we clamp to >= 1.
  intervalMinutes: 5,
  // true = only log what would be closed. Flip to false once the log looks right.
  dryRun: true,
  // Collapse a group when every tab in it has been idle this long.
  collapseAfterMin: 10,
  // Close ungrouped, unrecognised tabs idle this long.
  staleAfterMin: 60,
  // Close "forgotten" tabs (search results, remote desktop) idle this long.
  forgottenAfterMin: 15,
  // https URL that answers 2xx for a good key (sent as Bearer). Empty = the key
  // only gets a format check and the panel says it was not verified.
  verifyUrl: "",
  // Work services. Matching ungrouped tabs are pulled into a group named after
  // the service. The extension never closes a tab that sits in a group, so
  // these groups never disappear on their own.
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
    intervalMinutes: num(raw.intervalMinutes, d.intervalMinutes, 1, 120),
    dryRun: raw.dryRun === undefined ? d.dryRun : Boolean(raw.dryRun),
    collapseAfterMin: num(raw.collapseAfterMin, d.collapseAfterMin, 1, 1440),
    staleAfterMin: num(raw.staleAfterMin, d.staleAfterMin, 5, 10080),
    forgottenAfterMin: num(raw.forgottenAfterMin, d.forgottenAfterMin, 1, 1440),
    verifyUrl: httpsUrl(raw.verifyUrl),
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
