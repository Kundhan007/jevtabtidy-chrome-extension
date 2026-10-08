// Options page: edit config, trigger a pass, browse the closed-tab log.

import { loadConfig, resetConfig, saveConfig } from "../src/config.js";
import { requestOrigin } from "../src/license.js";
import { clearClosedLog, getClosedLog, reopen } from "../src/reaper.js";
import { describeRun } from "../src/rules.js";

const $ = (id) => document.getElementById(id);
const NUMBERS = [
  "intervalMinutes",
  "collapseAfterMin",
  "forgottenAfterMin",
  "staleAfterMin",
];

/** Fill the form from a config object. */
function render(cfg) {
  $("dryRun").checked = cfg.dryRun;
  for (const key of NUMBERS) $(key).value = cfg[key];
  $("verifyUrl").value = cfg.verifyUrl;
  $("decideUrl").value = cfg.decideUrl;
  $("policy").value = cfg.policy;
  $("services").value = JSON.stringify(cfg.services, null, 2);
  $("forgotten").value = cfg.forgotten.join("\n");
}

/** Read the form back into a raw config; throws on invalid services JSON. */
function readForm() {
  const raw = { dryRun: $("dryRun").checked };
  for (const key of NUMBERS) raw[key] = $(key).value;
  raw.verifyUrl = $("verifyUrl").value;
  raw.decideUrl = $("decideUrl").value;
  raw.policy = $("policy").value;
  raw.services = JSON.parse($("services").value);
  raw.forgotten = $("forgotten").value.split("\n");
  return raw;
}

function showError(message) {
  $("error").textContent = message;
}

/** "Last run 3:04 PM: grouped 2, closed 1 (dry run), collapsed 0, sorted 1". */
async function renderStatus() {
  const { lastRun } = await chrome.storage.local.get("lastRun");
  $("status").textContent = describeRun(lastRun);
}

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

    // Dry-run entries were never closed, so there is nothing to reopen.
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
    render(saved);
    // Needs this click: lets the extension call both URLs (one prompt).
    const granted = await requestOrigin(saved.verifyUrl, saved.decideUrl);
    showError(granted ? "" : "Saved, but access to the verify/decision URL was not granted.");
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
  await Promise.all([renderStatus(), renderLog()]);
});

$("clearLog").addEventListener("click", async () => {
  await clearClosedLog();
  await renderLog();
});

render(await loadConfig());
await Promise.all([renderStatus(), renderLog()]);
