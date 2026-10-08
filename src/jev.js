// Jev client (TypeSafe System One). POST https://api.typesafe.ai/v1/systemone
// with `Authorization: Bearer <key>`. The key rides on every call; there is no
// token exchange, so the only "handshake" is the one-time probe in license.js.
//
// Jev does not chat or list things. It answers typed questions, so we ask ONE
// Choice question per candidate tab: "close", or keep it and name the group
// that fits. Answers carry probabilities and we act only when Jev is sure.
//
//   request  { state: {policy, focus, groups}, model, questions: {t<id>: Choice} }
//   response { answers: {t<id>: {type:"choice", choice, probabilities, confidence}} }

import { clearSession, getToken } from "./license.js";
import { info, warn } from "./log.js";
import { recentIds, siteOf } from "./keep.js";
import { NONE, classify, idleMinutes, isBrowserPage, isProtected } from "./rules.js";

const CLOSE = "close";

/** The choices Jev picks from: close, one per configured category, or keep. */
function criteriaFor(cfg) {
  return {
    [CLOSE]: "The user has finished with it or forgot it (stale search, idle remote desktop, one-off lookup)",
    ...Object.fromEntries(cfg.categories.map((c) => [c.name, `Keep it; belongs in a group for: ${c.hint}`])),
    keep: "Keep it, but no group above fits",
  };
}

/**
 * Ungrouped, unprotected web tabs are the only ones we can act on; ask about the
 * idlest. Browser pages (New tab, Extensions) are handled by local rules instead.
 */
export function candidates(tabs, cfg, now, keep = new Set()) {
  return tabs
    .filter((t) => t.groupId === NONE && !isProtected(t) && !keep.has(t.id))
    .filter((t) => classify(t, cfg).kind !== "skip" && idleMinutes(t, now) >= cfg.askAfterMin)
    .filter((t) => !isBrowserPage(t.url || t.pendingUrl))
    .sort((a, b) => idleMinutes(b, now) - idleMinutes(a, now))
    .slice(0, cfg.maxTabsPerCall);
}

/** Build the TypeSafe request plus the list of tabs it asks about. */
export function buildRequest(tabs, groups, now, cfg, keep = new Set()) {
  const asked = candidates(tabs, cfg, now, keep);
  // The objective: what the user used most recently. Jev judges relevance against it.
  const recent = recentIds(tabs, cfg.keepRecent);
  const focus = tabs
    .filter((t) => recent.has(t.id) && classify(t, cfg).kind !== "skip")
    .sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0))
    .map((t) => ({ title: t.title || "", url: t.url }));

  const criteria = criteriaFor(cfg);
  const questions = {};
  for (const t of asked) {
    questions[`t${t.id}`] = {
      type: "choice",
      instructions: {
        tab: {
          title: t.title || "",
          url: t.url,
          idleMinutes: Math.round(idleMinutes(t, now)),
          openedFromAnotherTab: t.openerTabId != null,
        },
        question: "What should happen to `tab`, given the policy and focus in the state?",
      },
      criteria,
    };
  }
  const state = { policy: cfg.policy, focus, existingGroups: groups.map((g) => g.title).filter(Boolean) };
  return { request: { state, model: cfg.model, questions }, asked };
}

const pct = (p) => Math.round(p * 100);

/**
 * Turn Jev's answers into actions. Anything malformed or below the confidence
 * bar is ignored, so a confused answer can only ever mean "do nothing".
 */
export function parseDecision(data, asked, cfg) {
  const close = [];
  const judged = []; // every usable answer, so callers can explain what was kept
  const why = {};
  const buckets = new Map(); // category name -> { color, tabIds }

  for (const tab of asked) {
    const answer = data?.answers?.[`t${tab.id}`];
    if (answer?.type !== "choice" || typeof answer.choice !== "string") continue;
    const p = Number(answer.probabilities?.[answer.choice] ?? answer.confidence);
    if (!(p >= 0)) continue;
    judged.push({ id: tab.id, choice: answer.choice, p });

    if (answer.choice === CLOSE) {
      if (p >= cfg.closeConfidence) {
        close.push(tab.id);
        why[tab.id] = `${pct(p)}% sure it is finished`;
      }
      continue;
    }
    const category = cfg.categories.find((c) => c.name === answer.choice);
    if (!category || p < cfg.groupConfidence) continue;
    if (!buckets.has(category.name)) buckets.set(category.name, { color: category.color, tabIds: [] });
    buckets.get(category.name).tabIds.push(tab.id);
  }

  // Small groups are clutter: a category needs minGroupSize tabs before it gets one.
  const groups = [...buckets]
    .filter(([, { tabIds }]) => tabIds.length >= cfg.minGroupSize)
    .map(([name, { color, tabIds }]) => ({ name, color, tabIds }));
  return { close, groups, why, judged };
}

/** The raw POST. Returns {status: ok|unauthorized|error, data?, message?}. */
export async function decide(url, token, body, fetchImpl = fetch, timeoutMs = 20000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
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

/** One line per tab Jev looked at and left open, saying why. */
function explainKept(decision, asked, cfg) {
  const byId = new Map(asked.map((t) => [t.id, t]));
  for (const { id, choice, p } of decision.judged) {
    if (decision.close.includes(id)) continue;
    const why =
      choice === CLOSE
        ? `wanted close at ${pct(p)}%, below the ${pct(cfg.closeConfidence)}% bar`
        : `Jev says ${choice} (${pct(p)}%)`;
    info("jev.kept", { host: siteOf(byId.get(id)?.url || ""), why });
  }
}

/**
 * Ask Jev what to do. via: "jev" (decision attached), "local" (no decideUrl
 * set), or "fallback" (Jev unusable, reason attached; caller uses local rules).
 * A 401/403 clears the session and retries once after re-checking the key.
 */
export async function plan(cfg, tabs, groups, now = Date.now(), keep = new Set()) {
  if (!cfg.decideUrl) return { via: "local" };
  const { request, asked } = buildRequest(tabs, groups, now, cfg, keep);
  info("jev.request", { asked: asked.length, candidates: tabs.length });
  if (asked.length === 0) return { via: "jev", decision: { close: [], groups: [], why: {}, judged: [] }, askedIds: [] };

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const token = await getToken(cfg.verifyUrl);
    if (!token) return { via: "fallback", reason: "key check failed" };

    const sent = Date.now();
    const res = await decide(cfg.decideUrl, token, request);
    info("jev.response", { result: res.status, ms: Date.now() - sent, attempt: attempt + 1 });
    if (res.status === "ok") {
      const decision = parseDecision(res.data, asked, cfg);
      info("jev.decision", { close: decision.close.length, groups: decision.groups.length });
      explainKept(decision, asked, cfg);
      return { via: "jev", decision, askedIds: asked.map((t) => t.id) };
    }
    if (res.status === "unauthorized") {
      warn("jev.unauthorized", { action: "clearing session and retrying once" });
      await clearSession();
      continue;
    }
    warn("jev.error", { message: res.message });
    return { via: "fallback", reason: res.message };
  }
  return { via: "fallback", reason: "key rejected twice" };
}
