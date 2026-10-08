// Pure tab classification. No chrome.* calls here so node can test it.

export const MIN = 60 * 1000;

// Same value as chrome.tabGroups.TAB_GROUP_ID_NONE, duplicated to stay chrome-free.
export const NONE = -1;

/** "www.google.com/search" for "https://www.google.com/search?q=x"; "" if not http(s). */
export function hostPath(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return "";
    return (u.hostname + u.pathname).toLowerCase();
  } catch {
    return "";
  }
}

/** True when any pattern is a substring of the url's host+path. */
// ponytail: substring match, so "evil.com/github.com" also hits "github.com".
// Anchor to the hostname if that ever bites.
export function matches(url, patterns) {
  const hp = hostPath(url);
  return hp !== "" && patterns.some((p) => hp.includes(p.toLowerCase()));
}

/** First configured service whose patterns match the url, else null. */
export function serviceFor(url, services) {
  return services.find((s) => matches(url, s.patterns)) ?? null;
}

/** Minutes since the tab was last used. */
export function idleMinutes(tab, now) {
  // lastAccessed is missing on old Chrome: treat as "just used", never reap blindly.
  return (now - (tab.lastAccessed ?? now)) / MIN;
}

/** chrome:// and about: pages (New tab, Extensions, Settings): never worth keeping open. */
export function isBrowserPage(url) {
  return /^(chrome|about):/i.test(url || "");
}

/**
 * Decide what a tab is.
 *   skip      pinned, or some other non-web page (file://, extension pages)
 *   service   matches a configured work service
 *   forgotten browser pages, or matches the "forgotten" list (search, remote desktop)
 *   other     everything else
 */
export function classify(tab, cfg) {
  const url = tab.url || tab.pendingUrl || "";
  if (tab.pinned) return { kind: "skip" };
  // New tab / Extensions / Settings pages pile up; treat them as forgotten.
  if (isBrowserPage(url)) return { kind: "forgotten" };
  if (hostPath(url) === "") return { kind: "skip" };
  const service = serviceFor(url, cfg.services);
  if (service) return { kind: "service", service };
  if (matches(url, cfg.forgotten)) return { kind: "forgotten" };
  return { kind: "other" };
}

/** Never close these, however idle they look. */
export function isProtected(tab) {
  return Boolean(tab.pinned || tab.active || tab.audible);
}

/** Map groupId -> tabs, ignoring ungrouped tabs. */
export function tabsByGroup(tabs) {
  const map = new Map();
  for (const tab of tabs) {
    if (tab.groupId === NONE) continue;
    if (!map.has(tab.groupId)) map.set(tab.groupId, []);
    map.get(tab.groupId).push(tab);
  }
  return map;
}

/**
 * Ids of groups that currently hold an active tab (one per window at most).
 * Collapsing such a group would switch the user away from what they are
 * looking at, so callers leave these alone.
 */
export function activeGroupIds(tabs) {
  const ids = new Set();
  for (const tab of tabs) {
    if (tab.active && tab.groupId !== NONE) ids.add(tab.groupId);
  }
  return ids;
}

/** True when every tab in the list has been idle for at least `minutes`. */
export function allIdle(tabs, minutes, now) {
  return tabs.length > 0 && tabs.every((t) => idleMinutes(t, now) >= minutes);
}

/**
 * Sort key for group titles: case-insensitive A-Z, untitled groups last.
 * Pass to Array.sort via titleCompare.
 */
export function titleKey(title) {
  const t = (title || "").trim().toLowerCase();
  return t === "" ? "￿" : t;
}

export function titleCompare(a, b) {
  return titleKey(a.title).localeCompare(titleKey(b.title));
}

/** "Decisions: Jev." / "Decisions: local rules (Jev unavailable: timed out)." */
function via(run) {
  if (run.via === "jev") return "Decisions: Jev.";
  if (run.via === "fallback") return `Decisions: local rules (Jev unavailable: ${run.reason}).`;
  return "Decisions: local rules.";
}

/** "Last run 3:04 PM: grouped 2, closed 1, collapsed 0, sorted 1." */
export function describeRun(run) {
  if (!run) return "No pass has run yet.";
  const when = new Date(run.at).toLocaleTimeString();
  const err = run.error ? ` ERROR: ${run.error}` : "";
  return (
    `Last run ${when}: grouped ${run.grouped}, closed ${run.closed}, ` +
    `collapsed ${run.collapsed}, sorted ${run.sorted}. ${via(run)}${err}`
  );
}

/** Host in bold, path and query on a second muted line (cut by CSS, full URL on hover). */
export function splitUrl(url) {
  try {
    const u = new URL(url);
    return { host: u.host, path: `${u.pathname}${u.search}${u.hash}`.replace(/^\/$/, "") };
  } catch {
    return { host: url, path: "" };
  }
}

/** One-line human description used in logs. */
export function describe(tab, now) {
  const title = (tab.title || "(untitled)").slice(0, 60);
  return `${title} <${tab.url}> idle ${Math.round(idleMinutes(tab, now))}m`;
}
