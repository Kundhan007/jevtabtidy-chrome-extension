// Options page: edit config, trigger a pass, browse the closed-tab log.

import { brainText, loadBrain, loadConfig, resetConfig, revertBrainText, saveBrainText, saveConfig } from "../src/brain.js";
import { clearLog, countLevels, filterLevel, formatLog, getLog, info } from "../src/log.js";
import { clearClosedLog, getClosedLog, reopen } from "../src/reaper.js";
import { describeRun } from "../src/rules.js";

const $ = (id) => document.getElementById(id);
const NUMBERS = [
  "intervalMinutes",
  "collapseAfterMin",
  "forgottenAfterMin",
  "staleAfterMin",
  "keepRecent",
  "minGroupSize",
  "idleCloseHours",
  "liveWindowHours",
];

/** Fill the form from a config object. */
function render(cfg) {
  for (const key of NUMBERS) $(key).value = cfg[key];
  $("policy").value = cfg.policy;
  $("services").value = JSON.stringify(cfg.services, null, 2);
  $("forgotten").value = cfg.forgotten.join("\n");
}

/** Read the form back into a raw config; throws on invalid services JSON. */
function readForm() {
  const raw = {};
  for (const key of NUMBERS) raw[key] = $(key).value;
  raw.policy = $("policy").value;
  raw.services = JSON.parse($("services").value);
  raw.forgotten = $("forgotten").value.split("\n");
  return raw;
}

function showError(message) {
  $("error").textContent = message;
}

/** "Last run 3:04 PM: grouped 2, closed 1, collapsed 0, sorted 1". */
async function renderStatus() {
  const { lastRun } = await chrome.storage.local.get("lastRun");
  $("status").textContent = describeRun(lastRun);
}

/** Say whether brain.yaml loaded cleanly, or list what is wrong with it. */
async function renderBrain() {
  const { problems } = await loadBrain();
  const el = $("brainState");
  el.className = problems.length > 0 ? "muted bad" : "muted";
  el.textContent =
    problems.length > 0 ? `brain.yaml problems: ${problems.join("; ")}` : "brain.yaml loaded with no problems.";
}

async function renderBrainText() {
  try {
    $("brainText").value = await brainText();
  } catch (err) {
    $("brainText").value = `could not read brain.yaml: ${err.message}`;
  }
}

async function refreshAll() {
  render(await loadConfig());
  await Promise.all([renderBrain(), renderBrainText()]);
}

$("brainSave").addEventListener("click", async () => {
  try {
    const warnings = await saveBrainText($("brainText").value);
    info("brain.saved", { warnings: warnings.length });
    await refreshAll();
    showError(warnings.length > 0 ? `Saved with warnings: ${warnings.join("; ")}` : "brain.yaml saved.");
  } catch (err) {
    showError(`Not saved: ${err.message}`);
  }
});

$("brainRevert").addEventListener("click", async () => {
  await revertBrainText();
  await refreshAll();
  showError("Reverted to the brain.yaml file.");
});

async function renderLog() {
  const body = $("log");
  body.replaceChildren();
  for (const entry of await getClosedLog()) {
    const row = body.insertRow();
    const when = new Date(entry.at).toLocaleString();
    row.insertCell().textContent = entry.dryRun ? `${when} (dry)` : when;

    const tab = row.insertCell();
    tab.textContent = entry.title || "(untitled)";
    const url = document.createElement("div");
    url.className = "url";
    url.textContent = entry.url;
    tab.append(url);

    row.insertCell().textContent = entry.reason;

    // Old dry-run entries were never closed, so there is nothing to reopen.
    const action = row.insertCell();
    if (!entry.dryRun) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = "Reopen";
      button.addEventListener("click", () => reopen(entry));
      action.append(button);
    }
  }
}

$("form").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const saved = await saveConfig(readForm());
    info("settings.saved", { intervalMin: saved.intervalMinutes, keepRecent: saved.keepRecent });
    render(saved);
    showError("");
  } catch (err) {
    showError(`Not saved: ${err.message}`);
  }
});

$("reset").addEventListener("click", async () => {
  render(await resetConfig());
  showError("");
});

$("run").addEventListener("click", async () => {
  $("status").textContent = "Running…";
  await chrome.runtime.sendMessage({ type: "tidy-now" });
  await Promise.all([renderStatus(), renderLog(), renderActivity(), renderBrain(), renderBrainText()]);
});

async function renderActivity() {
  const entries = await getLog();
  const { info: infos, warn: warns, error: errors } = countLevels(entries);
  $("logCounts").textContent = `${infos} info, ${warns} warnings, ${errors} errors`;
  const shown = filterLevel(entries, $("logLevel").value);
  $("activity").textContent = shown.length > 0 ? formatLog(shown) : "No activity to show.";
}

$("logRefresh").addEventListener("click", renderActivity);
$("logLevel").addEventListener("change", renderActivity);
$("logClear").addEventListener("click", async () => {
  await clearLog();
  await renderActivity();
});
$("logCopy").addEventListener("click", async () => {
  await navigator.clipboard.writeText($("activity").textContent);
  showError("Activity log copied.");
});
// New events show up without a manual refresh.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.activityLog) renderActivity();
});

$("clearLog").addEventListener("click", async () => {
  await clearClosedLog();
  await renderLog();
});

render(await loadConfig());
await Promise.all([renderStatus(), renderLog(), renderActivity(), renderBrain(), renderBrainText()]);
