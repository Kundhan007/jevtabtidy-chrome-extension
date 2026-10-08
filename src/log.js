// Activity log: a ring buffer in storage.local plus a console mirror.
// It records what each pass saw, asked and did, so "why did (or didn't) it close
// X?" can be answered later. Pass counts, hosts and reasons in `data`; never keys,
// tokens or full URLs. redact() is a second line of defence, not the first.
// View it in Settings -> Activity log.

const LOG_KEY = "activityLog";
const MAX_LINES = 500;
const MAX_AGE_DAYS = 7; // older lines no longer help explain anything

// Serialises writes so two events in the same tick cannot overwrite each other.
let chain = Promise.resolve();

/** Mask anything that looks like a credential. */
export function redact(value) {
  return String(value)
    .replace(/apikey_[\w-]+/gi, "apikey_<redacted>")
    .replace(/Bearer\s+[\w.~+/=-]+/gi, "Bearer <redacted>")
    .replace(/\b[0-9a-f]{32,}\b/gi, "<hex>");
}

/** Numbers and booleans pass through; everything else becomes short redacted text. */
export function clean(data) {
  const out = {};
  for (const [key, value] of Object.entries(data)) {
    const plain = typeof value === "number" || typeof value === "boolean" || value === null;
    out[key] = plain ? value : redact(value).replace(/\s+/g, " ").slice(0, 160);
  }
  return out;
}

/** "21:13:16 INFO  pass.end ms=812 closed=15 dryRun=true" */
export function formatLine(entry) {
  const time = new Date(entry.t).toLocaleTimeString([], { hour12: false });
  const pairs = Object.entries(entry.data).map(([k, v]) => `${k}=${v}`);
  const tail = pairs.length > 0 ? ` ${pairs.join(" ")}` : "";
  return `${time} ${entry.level.toUpperCase().padEnd(5)} ${entry.event}${tail}`;
}

/** Pure: keep entries newer than `days`, then at most `max` of them (list is newest first). */
export function trimLog(entries, now, days = MAX_AGE_DAYS, max = MAX_LINES) {
  const oldest = now - days * 86_400_000;
  return entries.filter((e) => e.t >= oldest).slice(0, max);
}

/** The whole log as text, newest first, one line per event. */
export function formatLog(entries) {
  return entries.map(formatLine).join("\n");
}

/** How many entries of each level: {info, warn, error}. */
export function countLevels(entries) {
  const counts = { info: 0, warn: 0, error: 0 };
  for (const entry of entries) counts[entry.level] = (counts[entry.level] ?? 0) + 1;
  return counts;
}

/** The newest error as a log line, or "" when there is none. */
export function lastError(entries) {
  const entry = entries.find((e) => e.level === "error");
  return entry ? formatLine(entry) : "";
}

export function errorData(err) {
  return { error: String(err?.message ?? err) };
}

export async function getLog() {
  return (await chrome.storage.local.get(LOG_KEY))[LOG_KEY] ?? [];
}

export async function clearLog() {
  await chrome.storage.local.remove(LOG_KEY);
}

async function append(entry) {
  const lines = await getLog();
  lines.unshift(entry); // newest first
  await chrome.storage.local.set({ [LOG_KEY]: trimLog(lines, entry.t) });
}

/** Record one event. Never throws: logging must not break a pass. */
export function log(level, event, data = {}) {
  const entry = { t: Date.now(), level, event, data: clean(data) };
  const mirror = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
  mirror(`jevtabtidy ${formatLine(entry)}`);
  chain = chain.then(() => append(entry)).catch(() => {});
  return chain;
}

export const info = (event, data) => log("info", event, data);
export const warn = (event, data) => log("warn", event, data);
export const error = (event, data) => log("error", event, data);
