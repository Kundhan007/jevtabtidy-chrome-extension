// Tab group operations: create/fill service groups, collapse idle ones, sort A-Z.
// Nothing here ever closes a tab or ungroups one, so groups are never deleted.

import {
  NONE,
  activeGroupIds,
  allIdle,
  classify,
  tabsByGroup,
  titleCompare,
} from "./rules.js";

/**
 * Pull ungrouped tabs that match a work service into a group named after it.
 * Reuses an existing group with the same title in the same window.
 */
export async function ensureServiceGroups(tabs, cfg) {
  const wanted = new Map(); // "windowId|name" -> { windowId, service, tabIds }
  for (const tab of tabs) {
    // Never steal a tab from a group the user (or we) already placed it in.
    if (tab.groupId !== NONE) continue;
    const c = classify(tab, cfg);
    if (c.kind !== "service") continue;
    const key = `${tab.windowId}|${c.service.name}`;
    if (!wanted.has(key)) {
      wanted.set(key, { windowId: tab.windowId, service: c.service, tabIds: [] });
    }
    wanted.get(key).tabIds.push(tab.id);
  }

  let moved = 0;
  for (const { windowId, service, tabIds } of wanted.values()) {
    const [existing] = await chrome.tabGroups.query({
      windowId,
      title: service.name,
    });
    if (existing) {
      await chrome.tabs.group({ tabIds, groupId: existing.id });
    } else {
      const groupId = await chrome.tabs.group({
        tabIds,
        createProperties: { windowId },
      });
      await chrome.tabGroups.update(groupId, {
        title: service.name,
        color: service.color,
        collapsed: false,
      });
    }
    moved += tabIds.length;
  }
  return moved;
}

/**
 * Collapse every expanded group whose tabs are all idle. A group holding the
 * active tab of any window is skipped, because collapsing it would yank focus.
 */
export async function collapseIdle(tabs, cfg, now) {
  const byGroup = tabsByGroup(tabs);
  const busy = activeGroupIds(tabs);
  const groups = await chrome.tabGroups.query({});
  let collapsed = 0;
  for (const group of groups) {
    if (group.collapsed || busy.has(group.id)) continue;
    const members = byGroup.get(group.id) ?? [];
    if (!allIdle(members, cfg.collapseAfterMin, now)) continue;
    await chrome.tabGroups.update(group.id, { collapsed: true });
    collapsed += 1;
  }
  return collapsed;
}

/**
 * Order the groups of one window alphabetically. Groups are packed right after
 * the pinned tabs, loose tabs follow. Skips the work when already sorted.
 */
export async function sortGroups(windowId) {
  const groups = await chrome.tabGroups.query({ windowId });
  if (groups.length < 2) return false;

  const tabs = await chrome.tabs.query({ windowId });
  const pinned = tabs.filter((t) => t.pinned).length;
  const members = (id) => tabs.filter((t) => t.groupId === id);
  const firstIndex = (id) => Math.min(...members(id).map((t) => t.index));

  const current = [...groups].sort((a, b) => firstIndex(a.id) - firstIndex(b.id));
  const wanted = [...groups].sort(titleCompare);
  if (current.every((g, i) => g.id === wanted[i].id)) return false;

  // Place groups front to back; each move only disturbs tabs after `index`.
  let index = pinned;
  for (const group of wanted) {
    await chrome.tabGroups.move(group.id, { index });
    index += members(group.id).length;
  }
  return true;
}

/** Sort the groups of every window that has at least one tab. */
export async function sortAllWindows(tabs) {
  const windowIds = new Set(tabs.map((t) => t.windowId));
  let sorted = 0;
  for (const id of windowIds) {
    if (await sortGroups(id)) sorted += 1;
  }
  return sorted;
}
