// Jev client: one DECISION call per pass, authenticated by the cached session
// token from license.js. No handshake happens here unless the token expired.
//
// Assumed contract (change here if Jev differs):
//   POST decideUrl   Authorization: Bearer <token>
//   request  { tabs: [{id, windowId, title, url, groupId, idleMin, active, audible}],
//              groups: [{id, windowId, title}] }
//   response { close: [tabId], groups: [{name, color, tabIds: [tabId]}] }

import { COLORS } from "./config.js";
import { clearSession, getToken } from "./license.js";
import { NONE, hostPath, idleMinutes } from "./rules.js";

// Keeps one request small; the most idle tabs are the ones worth deciding on.
const MAX_TABS = 300;

/** What Jev sees. Pinned and non-web tabs are left out: they are never touched. */
export function buildPayload(tabs, groups, now) {
  const candidates = tabs.filter((t) => !t.pinned && hostPath(t.url || "") !== "");
  // Stable sort keeps the original order for equally idle tabs.
  const idleFirst = [...candidates].sort(
    (a, b) => idleMinutes(b, now) - idleMinutes(a, now),
  );
  const kept = new Set(idleFirst.slice(0, MAX_TABS));
  return {
    tabs: candidates
      .filter((t) => kept.has(t))
      .map((t) => ({
        id: t.id,
        windowId: t.windowId,
        title: t.title || "",
        url: t.url,
        groupId: t.groupId ?? NONE,
        idleMin: Math.round(idleMinutes(t, now)),
        active: Boolean(t.active),
        audible: Boolean(t.audible),
      })),
    groups: groups.map((g) => ({ id: g.id, windowId: g.windowId, title: g.title || "" })),
  };
}

/**
 * Trust nothing from the network: keep only ids we sent, known colors and
 * non-empty names. Anything malformed is dropped, never thrown on.
 */
export function parseDecision(data, tabs) {
  const known = new Set(tabs.map((t) => t.id));
  const ids = (list) => (Array.isArray(list) ? list.filter((id) => known.has(id)) : []);

  const close = [...new Set(ids(data?.close))];
  const groups = (Array.isArray(data?.groups) ? data.groups : [])
    .map((g) => ({
      name: String(g?.name ?? "").trim().slice(0, 40),
      color: COLORS.includes(g?.color) ? g.color : "grey",
      tabIds: ids(g?.tabIds),
    }))
    .filter((g) => g.name && g.tabIds.length > 0);
  return { close, groups };
}

/** The raw POST. Returns {status: ok|unauthorized|error, data?, message?}. */
export async function decide(url, token, payload, fetchImpl = fetch, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (res.status === 401 || res.status === 403) return { status: "unauthorized" };
    if (!res.ok) return { status: "error", message: `Jev answered ${res.status}` };
    return { status: "ok", data: await res.json() };
  } catch (err) {
    const why = err.name === "AbortError" ? "timed out" : err.message;
    return { status: "error", message: `Jev call failed: ${why}` };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Ask Jev what to do. via: "jev" (decision attached), "local" (no decideUrl
 * set), or "fallback" (Jev unusable, reason attached; caller uses local rules).
 * A 401/403 clears the session and retries once with a fresh handshake.
 */
export async function plan(cfg, tabs, groups, now = Date.now()) {
  if (!cfg.decideUrl) return { via: "local" };
  const payload = buildPayload(tabs, groups, now);

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const token = await getToken(cfg.verifyUrl);
    if (!token) return { via: "fallback", reason: "handshake failed" };

    const res = await decide(cfg.decideUrl, token, payload);
    if (res.status === "ok") return { via: "jev", decision: parseDecision(res.data, tabs) };
    if (res.status === "unauthorized") {
      await clearSession();
      continue;
    }
    return { via: "fallback", reason: res.message };
  }
  return { via: "fallback", reason: "session rejected twice" };
}
