// Toolbar panel: enter a key, see whether it verified, run a pass.
// Activating stores the key; the background worker sees the change and starts.

import { loadConfig, saveConfig } from "../src/config.js";
import { activate, deactivate, getLicense, mask } from "../src/license.js";
import { getLog, info, lastError, warn } from "../src/log.js";
import { getClosedLog, lastBatch, undoLast } from "../src/reaper.js";
import { describeRun } from "../src/rules.js";

const $ = (id) => document.getElementById(id);

// How each stored state reads in the panel: [css class, running?]
const LOOK = {
  ok: ["ok", true],
  unverified: ["warn", true],
  rejected: ["bad", false],
  unreachable: ["bad", false],
  invalid: ["bad", false],
};

function setState(text, cls = "") {
  const el = $("state");
  el.textContent = text;
  el.className = `state ${cls}`;
}

async function renderLast() {
  const { lastRun } = await chrome.storage.local.get("lastRun");
  $("last").textContent = describeRun(lastRun);
  // Surface the newest error so a silent failure is visible without opening Settings.
  const err = lastError(await getLog());
  $("lasterr").hidden = err === "";
  $("lasterr").textContent = err;
}

/** Label and enable the undo button from the newest real closing pass. */
async function renderUndo(dryRun) {
  const count = lastBatch(await getClosedLog()).length;
  $("undo").disabled = count === 0;
  // Dry run closes nothing, so say that instead of a bare "Nothing to undo".
  const none = dryRun ? "Nothing to undo: dry run closes nothing" : "Nothing to undo";
  $("undo").textContent = count === 0 ? none : `Undo last close (${count})`;
}

/** "Key checked 3:04 PM" so the user can tell the check really happened. */
function checkedLabel(license) {
  if (!license?.checkedAt) return "";
  return `Key checked ${new Date(license.checkedAt).toLocaleTimeString()}.`;
}

/** Disable the buttons while a check or pass is in flight. */
function busy(flag) {
  for (const id of ["activate", "run", "remove"]) $(id).disabled = flag;
}

// Focus the key box when the gate is showing so typing can start at once.
function focusGate() {
  if (!$("gate").hidden) $("key").focus();
}

/** Redraw the whole panel from what is stored. */
async function render() {
  const cfg = await loadConfig();
  let license = await getLicense();
  // A key saved before a verify URL existed gets its real check now.
  if (license?.state === "unverified" && cfg.verifyUrl) {
    license = await activate(license.key, cfg.verifyUrl);
  }
  $("dry").hidden = !cfg.dryRun;
  const [cls, running] = LOOK[license?.state] ?? ["", false];

  $("gate").hidden = running;
  $("active").hidden = !running;
  $("masked").textContent = mask(license?.key);

  if (!license) setState("Enter your key to start Jevtabtidy.", "warn");
  else setState(`${license.message} ${checkedLabel(license)}`, cls);

  await renderLast();
  await renderUndo(cfg.dryRun);
  focusGate();
}

$("activate").addEventListener("click", async () => {
  busy(true);
  setState("Checking…");
  try {
    const cfg = await loadConfig();
    const license = await activate($("key").value, cfg.verifyUrl);
    // The key itself is never logged, only how the check ended.
    (license.state === "ok" || license.state === "unverified" ? info : warn)("key.activate", { state: license.state });
    $("key").value = "";
  } catch (err) {
    setState(`Something went wrong: ${err.message}`, "bad");
    busy(false);
    return;
  }
  busy(false);
  await render();
});

// Enter submits, like a normal form.
$("key").addEventListener("keydown", (event) => {
  if (event.key === "Enter") $("activate").click();
});

$("remove").addEventListener("click", async () => {
  await deactivate();
  info("key.removed");
  await render();
});

$("run").addEventListener("click", async () => {
  busy(true);
  setState("Running…");
  await chrome.runtime.sendMessage({ type: "tidy-now" });
  busy(false);
  await render();
});

$("dryoff").addEventListener("click", async () => {
  await saveConfig({ ...(await loadConfig()), dryRun: false });
  info("setting.dryRun", { dryRun: false, via: "popup" });
  await render();
});

$("undo").addEventListener("click", async () => {
  busy(true);
  const reopened = await undoLast();
  busy(false);
  await render();
  setState(`Reopened ${reopened} tab${reopened === 1 ? "" : "s"}.`, "ok");
});

$("options").addEventListener("click", (event) => {
  event.preventDefault();
  chrome.runtime.openOptionsPage();
});

await render();
