// Key gate: store a user-entered key, verify it once, and tell the rest of the
// extension whether it may run. The key lives in storage.local (never sync).
//
// ponytail: this is an on/off gate, not security. Anyone can edit the extension.
// Re-verify on a timer if the key can be revoked server-side.

const STORE_KEY = "license";

// ok = server accepted it; unverified = format fine, no verify URL configured.
const ACTIVE_STATES = ["ok", "unverified"];

/** 16-200 chars of letters, digits, "_" or "-". Catches pasted junk early. */
export function checkFormat(key) {
  return /^[\w-]{16,200}$/.test(key);
}

/** "…a1b2" – enough to recognise a key, not enough to leak it. */
export function mask(key) {
  return key ? `…${key.slice(-4)}` : "";
}

/**
 * Ask the verify URL whether the key is good. Sends `Authorization: Bearer`.
 * 2xx = ok, 401/403 = rejected, anything else or no answer = unreachable.
 * fetchImpl is injectable so the test needs no network.
 */
export async function verifyKey(key, url, fetchImpl = fetch, timeoutMs = 8000) {
  if (!checkFormat(key)) {
    return { state: "invalid", message: "That does not look like a key (16+ letters, digits, _ or -)." };
  }
  if (!url) {
    return {
      state: "unverified",
      message: "Key saved, but no verify URL is set in Settings, so it was not checked.",
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, {
      headers: { Authorization: `Bearer ${key}` },
      signal: controller.signal,
    });
    if (res.ok) return { state: "ok", message: "Key verified. TabTidy is running." };
    if (res.status === 401 || res.status === 403) {
      return { state: "rejected", message: `The server rejected this key (${res.status}).` };
    }
    return { state: "unreachable", message: `The server answered ${res.status}; try again later.` };
  } catch (err) {
    const why = err.name === "AbortError" ? "timed out" : err.message;
    return { state: "unreachable", message: `Could not reach the verify URL: ${why}.` };
  } finally {
    clearTimeout(timer);
  }
}

/** "https://host/*" for the url, or null when it has no usable origin. */
function originPattern(url) {
  try {
    return `${new URL(url).origin}/*`;
  } catch {
    return null;
  }
}

/**
 * Ask Chrome for access to the verify URL's origin. Needs a user gesture, so
 * call it from a click in the options tab (a popup closes on the prompt).
 */
export async function requestOrigin(url) {
  const origin = originPattern(url);
  if (!origin) return true;
  return chrome.permissions.request({ origins: [origin] });
}

async function hasOrigin(url) {
  const origin = originPattern(url);
  return !origin || chrome.permissions.contains({ origins: [origin] });
}

export async function getLicense() {
  const stored = await chrome.storage.local.get(STORE_KEY);
  return stored[STORE_KEY] ?? null;
}

/** True when the extension may run. */
export async function isActive() {
  const license = await getLicense();
  return Boolean(license && ACTIVE_STATES.includes(license.state));
}

/** Verify and store the key. Returns the stored license record. */
export async function activate(rawKey, verifyUrl) {
  const key = String(rawKey ?? "").trim();
  let result;
  if (verifyUrl && checkFormat(key) && !(await hasOrigin(verifyUrl))) {
    result = {
      state: "unreachable",
      message: "No access to the verify URL yet. Open Settings and Save once to grant it.",
    };
  } else {
    result = await verifyKey(key, verifyUrl);
  }
  const license = { key, ...result, checkedAt: Date.now() };
  await chrome.storage.local.set({ [STORE_KEY]: license });
  return license;
}

export async function deactivate() {
  await chrome.storage.local.remove(STORE_KEY);
}
