// Toolbar panel: enter a key, see whether it verified, run a pass.
// Activating stores the key; the background worker sees the change and starts.

import { loadConfig } from "../src/config.js";
import { activate, deactivate, getLicense, mask } from "../src/license.js";
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
  const license = await getLicense();
  const [cls, running] = LOOK[license?.state] ?? ["", false];

  $("gate").hidden = running;
  $("active").hidden = !running;
  $("masked").textContent = mask(license?.key);

  if (!license) setState("Enter your key to start Jevtabtidy.", "warn");
  else setState(`${license.message} ${checkedLabel(license)}`, cls);

  await renderLast();
  focusGate();
}

$("activate").addEventListener("click", async () => {
  busy(true);
  setState("Checking…");
  try {
    const cfg = await loadConfig();
    await activate($("key").value, cfg.verifyUrl);
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
  await render();
});

$("run").addEventListener("click", async () => {
  busy(true);
  setState("Running…");
  await chrome.runtime.sendMessage({ type: "tidy-now" });
  busy(false);
  await render();
});

$("options").addEventListener("click", (event) => {
  event.preventDefault();
  chrome.runtime.openOptionsPage();
});

await render();
