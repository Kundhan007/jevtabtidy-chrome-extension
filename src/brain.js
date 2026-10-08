// Brain: where the settings come from. Three layers, later wins:
//   1. code defaults       (config.js)
//   2. brain.yaml          (the file in the extension folder; this is what a person
//                           or a coding agent edits, then reloads the extension)
//   3. Settings overrides  (chrome.storage.sync; ONLY the fields changed by hand,
//                           so every untouched field keeps following brain.yaml)
// brainProblems() explains what is wrong with brain.yaml in plain sentences, so
// an agent that edited it badly can read the message and fix it.

import { COLORS, DEFAULTS, NUMBERS, httpsUrl, sanitize } from "./config.js";
import { load } from "./vendor/js-yaml.mjs";

const STORE_KEY = "config";
const BRAIN_FILE = "brain.yaml";

let cached = null; // one read of the file per page / worker lifetime

/** Plain-language problems with a parsed brain.yaml. Empty list = fine. */
export function brainProblems(raw) {
  const out = [];
  for (const key of Object.keys(raw)) {
    if (!(key in DEFAULTS)) out.push(`unknown setting "${key}" (ignored)`);
  }
  for (const [key, [min, max]] of Object.entries(NUMBERS)) {
    if (!(key in raw)) continue;
    const n = Number(raw[key]);
    if (!Number.isFinite(n)) out.push(`"${key}" must be a number, got ${JSON.stringify(raw[key])}`);
    else if (n < min || n > max) out.push(`"${key}" is ${n}, outside ${min}-${max}; it will be clamped`);
  }
  for (const key of ["verifyUrl", "decideUrl"]) {
    if (key in raw && !httpsUrl(raw[key])) out.push(`"${key}" must be an https URL; the default is used instead`);
  }
  for (const key of ["policy", "model"]) {
    if (key in raw && !String(raw[key] ?? "").trim()) out.push(`"${key}" is empty; the default is used instead`);
  }
  if ("forgotten" in raw && !Array.isArray(raw.forgotten)) out.push('"forgotten" must be a list of text patterns');
  for (const key of ["services", "categories"]) {
    if (!(key in raw)) continue;
    if (!Array.isArray(raw[key])) {
      out.push(`"${key}" must be a list`);
      continue;
    }
    raw[key].forEach((item, i) => {
      if (!item?.name) out.push(`${key}[${i}] needs a "name"`);
      if (item?.color && !COLORS.includes(item.color)) {
        out.push(`${key}[${i}] color "${item.color}" must be one of: ${COLORS.join(", ")}`);
      }
      if (key === "services" && !(Array.isArray(item?.patterns) && item.patterns.length > 0)) {
        out.push(`services[${i}] needs a non-empty "patterns" list`);
      }
    });
  }
  return out;
}

/** Parse brain.yaml text: {raw, problems}. Never throws; a broken file yields no settings. */
export function parseBrain(text) {
  let raw;
  try {
    raw = load(text) ?? {};
  } catch (err) {
    const line = err.mark ? ` (line ${err.mark.line + 1})` : "";
    return { raw: {}, problems: [`${BRAIN_FILE} is not valid YAML: ${err.reason ?? err.message}${line}`] };
  }
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return { raw: {}, problems: [`${BRAIN_FILE} must be a mapping of "setting: value" lines`] };
  }
  return { raw, problems: brainProblems(raw) };
}

async function readBrainFile() {
  try {
    const res = await fetch(chrome.runtime.getURL(BRAIN_FILE));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return parseBrain(await res.text());
  } catch (err) {
    return { raw: {}, problems: [`could not read ${BRAIN_FILE}: ${err.message}`] };
  }
}

/** The parsed brain.yaml (cached): {raw, problems}. */
export function loadBrain() {
  cached ??= readBrainFile();
  return cached;
}

/** Fields of `full` that differ from `base`: the only thing worth storing. */
export function diffFromBase(full, base) {
  const out = {};
  for (const key of Object.keys(base)) {
    if (JSON.stringify(full[key]) !== JSON.stringify(base[key])) out[key] = full[key];
  }
  return out;
}

async function loadOverrides() {
  return (await chrome.storage.sync.get(STORE_KEY))[STORE_KEY] ?? {};
}

/** The effective config: defaults < brain.yaml < Settings overrides. */
export async function loadConfig() {
  const { raw } = await loadBrain();
  const stored = await loadOverrides();
  const overrides = diffFromBase(sanitize({ ...raw, ...stored }), sanitize(raw));
  // Self-heal: older builds stored every field, which would freeze the file's values.
  if (Object.keys(overrides).length !== Object.keys(stored).length) {
    await chrome.storage.sync.set({ [STORE_KEY]: overrides });
  }
  return sanitize({ ...raw, ...overrides });
}

/** Save fields changed in Settings; anything equal to brain.yaml is not stored. */
export async function saveConfig(partial) {
  const { raw } = await loadBrain();
  const full = sanitize({ ...raw, ...(await loadOverrides()), ...partial });
  await chrome.storage.sync.set({ [STORE_KEY]: diffFromBase(full, sanitize(raw)) });
  return full;
}

/** Drop every Settings override so brain.yaml (and defaults) apply again. */
export async function resetConfig() {
  await chrome.storage.sync.remove(STORE_KEY);
  return sanitize((await loadBrain()).raw);
}
