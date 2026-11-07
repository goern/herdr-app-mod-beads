// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Christoph Görn
//
// This program is free software: you can redistribute it and/or modify it under the terms of the
// GNU General Public License as published by the Free Software Foundation, either version 3 of the
// License, or (at your option) any later version. It is distributed in the hope that it will be
// useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or
// FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public License for more details.
// You should have received a copy of the license along with this program (LICENSE), or see
// <https://www.gnu.org/licenses/>.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { spaces, panes, focused, exec, openOverlay, nextCommand, appHome, readTextFile, props, closeOverlay } from "herdr";

const MIN = [1, 3];
// A beads binary on this machine is used first; if it is missing (or older than MIN) the configured toolbox runs it.
// Optional per-user settings in <herdr-app home>/data/beads-ready/config.json, e.g.
//   { "toolbox": "code", "unsetEnv": ["BEADS_DOLT_SHARED_SERVER", "BEADS_DOLT_SERVER_HOST"] }
// toolbox: a toolbox container that runs beads/vega when none is found on this machine.
// unsetEnv: environment variables the local beads is started without, but only for projects whose
//   .beads/metadata.json says dolt_mode "embedded" (a server-mode project needs those variables to find its server).
//   Both settings are off by default.
let CFG = { toolbox: null, unsetEnv: [] };
async function loadConfig() {
  try {
    const text = await readTextFile(`${appHome()}/data/beads-ready/config.json`);
    if (!text) return;
    const c = JSON.parse(text);
    CFG = {
      toolbox: typeof c.toolbox === "string" && c.toolbox ? c.toolbox : null,
      unsetEnv: Array.isArray(c.unsetEnv) ? c.unsetEnv.filter((v) => typeof v === "string" && /^[A-Za-z_][A-Za-z0-9_]*$/.test(v)) : [],
    };
  } catch {}
}
// Variables to unset for the project being read; set by unsetFor() before each round of commands.
let UNSET = [];
async function unsetFor(cwd, on) {
  if (!CFG.unsetEnv.length || on || !cwd) return [];
  try {
    const m = JSON.parse(await readTextFile(`${cwd}/.beads/metadata.json`));
    return m && m.dolt_mode === "embedded" ? CFG.unsetEnv : [];
  } catch { return []; }
}
const cmdFor = (runner, args) => (runner === "toolbox"
  ? ["toolbox", ["run", "-c", CFG.toolbox, "beads", ...args]]
  : UNSET.length ? ["env", [...UNSET.flatMap((v) => ["-u", v]), "beads", ...args]] : ["beads", args]);
const runnersFor = (on) => (CFG.toolbox && !on ? ["local", "toolbox"] : ["local"]);

const POLL_MS = 5000; // refresh while shown
const WATCH_MS = 1500; // cheap check whether the focused folder changed
// Typography after the film (typesetinthefuture.com/2014/12/01/alien): Helvetica for the Nostromo's title cards and
// labels (Nimbus Sans is the Helvetica clone), a serif for MU/TH/UR's own words, mono for ids.
const FONT_SANS = "Nimbus Sans";
const FONT_SERIF = "Noto Serif";
const FONT_MONO = "JetBrains Mono";
const BOOT = ["WEYLAND-YUTANI CORP", "NOSTROMO 180246", "MU/TH/UR 6000 ONLINE", "READING WORK QUEUE"];
const TYPE_ICONS = new Set(["task", "bug", "feature", "chore", "epic", "spike"]);

// Nostromo hit hard: now and then the CRT takes an electric shock.
const FIRST_SHOCK_MS = [8000, 12000];
const NEXT_SHOCK_MS = [25000, 70000];
const SHOCK_FRAMES = [1, 0.35, 1, 0.15, 0.7, 0.45, 0.9, 0.25, 0.5, 0.15, 0.3, 0.08];
const FRAME_MS = 55;
const GLYPHS = "▒░█▓#%/\\|<>_=+*";

// b4mad.industries phosphor: black, sage #698b69, light sage #9bcd9b, cream cursor #f4f1e8, orange on hover.
const NORMAL = { bg: "#000000", panel: "#060906", hi: "#f4f1e8", mid: "#9bcd9b", lo: "#698b69", dim: "#3d553d", line: "#698b69", ink: "#000000", hover: "#ffa500", hoverBg: "#0d140d" };
const FLASH = { bg: "#9bcd9b", panel: "#c9e6c9", hi: "#000000", mid: "#0a140a", lo: "#1f331f", dim: "#2b422b", line: "#000000", ink: "#9bcd9b", hover: "#000000", hoverBg: "#c9e6c9" };

const rand = (a, b) => a + Math.random() * (b - a);

// Props { cwd, on? } pin the panel to one folder instead of following the focused pane.
function location() {
  const pin = props()?.cwd;
  if (typeof pin === "string" && pin) return { cwd: pin, on: props()?.on ?? null };
  const space = spaces().find((s) => s.active), f = focused();
  const pane = f?.pane ? panes().find((p) => p.pane === f.pane) : null;
  const on = f?.pane === null ? (f.terminal?.includes("/") ? f.terminal.split("/")[0] : null) : space?.machine ?? null;
  return { cwd: pane?.cwd || f?.cwd || space?.folder, on };
}
const keyOf = () => JSON.stringify(location());

function versionOk(text) {
  const m = /(\d+)\.(\d+)/.exec(text || "");
  if (!m) return false;
  const [maj, min] = [Number(m[1]), Number(m[2])];
  return maj > MIN[0] || (maj === MIN[0] && min >= MIN[1]);
}

function ago(iso) {
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (!(s >= 0)) return "";
  if (s < 90) return "just now";
  if (s < 5400) return `${Math.round(s / 60)}m ago`;
  if (s < 129600) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

function parseJson(text) {
  const i = text.search(/[\[{]/);
  if (i < 0) return null;
  try { return JSON.parse(text.slice(i)); } catch { return null; }
}

export default class BeadsReady extends View {
  init(_props, cx) {
    this.state = "loading"; // loading | missing | old | error | ok
    this.info = "";
    this.items = [];
    this.blocked = [];
    this.sig = "";
    this.shock = null; // { frame, power, flash, seed }
    this.nextShock = Date.now() + rand(...FIRST_SHOCK_MS);
    this.context = keyOf();
    this.bootStep = 0; // the boot lines type out once, then the queue shows
    const step = (cx) => { this.bootStep += 1; cx.notify(); if (this.bootStep <= BOOT.length) cx.timer.after(380, step); };
    cx.timer.after(250, step);
    this.refresh(cx);
    cx.timer.every(POLL_MS, (cx) => this.refresh(cx));
    // `herdr-app do beads-ready.shock` triggers a surge on demand; `beads-ready.close` closes a copy opened as an overlay.
    cx.spawn(async (cx) => { for (;;) { const c = await nextCommand(); if (c === "shock" && !this.shock) this.startShock(cx); else if (c === "close" && props()?.overlay) closeOverlay(props().overlay); } });
    cx.timer.every(WATCH_MS, (cx) => {
      if (keyOf() !== this.context) this.refresh(cx);
      if (!this.shock && Date.now() >= this.nextShock) this.startShock(cx);
    });
  }

  openBead(id) {
    const { cwd, on } = location();
    openOverlay({ mod: "beads-detail", kind: "dialog", width: 620, height: 0.82, props: { id, cwd, on, runner: this.runner } });
  }

  startShock(cx) {
    this.shock = { frame: 0 };
    this.stepShock(cx);
  }

  stepShock(cx) {
    const f = this.shock.frame;
    if (f >= SHOCK_FRAMES.length) {
      this.shock = null;
      // sometimes a second jolt follows right behind
      this.nextShock = Date.now() + (Math.random() < 0.25 ? rand(600, 1500) : rand(...NEXT_SHOCK_MS));
      cx.notify();
      return;
    }
    this.shock = { frame: f + 1, power: SHOCK_FRAMES[f], flash: f === 0 || f === 2 || (f === 6 && Math.random() < 0.5), seed: Math.floor(Math.random() * 1e6) };
    cx.notify();
    cx.timer.after(FRAME_MS, (cx) => this.stepShock(cx));
  }

  refresh(cx) {
    if (this.busy) return;
    this.busy = true;
    const context = keyOf();
    const { cwd, on } = location();
    cx.spawn(async (cx) => {
      let state, info = "", items = [], blocked = [];
      await loadConfig();
      UNSET = await unsetFor(cwd, on);
      try {
        let runner = null, tooOld = null;
        for (const name of runnersFor(on)) {
          let v = null;
          try { v = await exec(...cmdFor(name, ["--version"]), { cwd, on }); } catch {}
          if (!v || v.code !== 0) continue;
          if (versionOk(v.stdout)) { runner = name; break; }
          tooOld = tooOld ?? v.stdout.trim();
        }
        this.runner = runner;
        if (!runner && tooOld) { state = "old"; info = `beads >= ${MIN.join(".")} required, found: ${tooOld}`; }
        else if (!runner) { state = "missing"; info = "`beads` not found" + (CFG.toolbox && !on ? ` (neither locally nor in toolbox ${CFG.toolbox}).` : "."); }
        else if (!cwd) { state = "error"; info = "No working directory."; }
        else {
          const r = await exec(...cmdFor(runner, ["ready", "--json", "--limit", "0"]), { cwd, on });
          const data = parseJson(r.stdout);
          if (Array.isArray(data)) {
            state = "ok"; items = data;
            // The graph: what waits on what. A failure here only hides the graph.
            try {
              const b = await exec(...cmdFor(runner, ["blocked", "--json"]), { cwd, on });
              const parsed = parseJson(b.stdout);
              if (Array.isArray(parsed)) blocked = parsed;
            } catch {}
          } else {
            state = "error";
            info = (data && data.error)
              || (() => { const ls = r.stderr.split("\n").map((l) => l.trim()).filter(Boolean); return ls.find((l) => l.startsWith("Error")) || ls.find((l) => !/^(warning|notice):/i.test(l)); })()
              || "beads ready failed.";
          }
        }
      } catch (e) { state = "error"; info = String(e); }
      this.busy = false;
      this.context = context;
      // Redraw only when something visible changed.
      const sig = JSON.stringify([state, info,
        items.map((i) => [i.id, i.title, i.priority, i.issue_type, i.updated_at]),
        blocked.map((i) => [i.id, i.title, i.priority, i.blocked_by])]);
      if (sig !== this.sig || this.state === "loading") {
        this.sig = sig; this.state = state; this.info = info; this.items = items; this.blocked = blocked;
        cx.notify();
      }
    });
  }

  render(_cx) {
    const sh = this.shock;
    const C = sh?.flash ? FLASH : NORMAL;
    const power = sh?.power ?? 0;
    const up = (x) => String(x ?? "").toUpperCase();
    // Shock: per-row sideways tearing and corrupted characters.
    const hash = (i) => { let x = (((sh?.seed ?? 0) + i * 2654435761) >>> 0); x ^= x >>> 15; x = Math.imul(x, 2246822519) >>> 0; x ^= x >>> 13; return (x % 1000) / 1000; };
    const tear = (i) => (sh && hash(i) < 0.45 * power + 0.1 ? Math.round((hash(i + 99) - 0.5) * 34 * power) : 0);
    const glitch = (txt, i = 0) => {
      if (!sh) return String(txt);
      return [...String(txt)].map((ch, k) => (ch !== " " && hash(i * 131 + k) < 0.12 * power ? GLYPHS[Math.floor(hash(k + 7) * GLYPHS.length)] : ch)).join("");
    };
    const row = (el, i) => { if (!sh) return el; const t = tear(i); return el.ml(Math.max(0, t)).mr(Math.max(0, -t)); };
    const txt = (s, col, size = 12, i = 0) => div().text_size(size).text_color(col).child(glitch(s, i));
    const cursor = () => div().id("cur").child("█").text_color(C.hi).loop("opacity", { from: 0.1, to: 1, period: 900 });

    const root = v_flex().size_full().bg(C.bg).font_family(FONT_SANS).text_size(13).gap(8).p(12).rounded(12)
      .border(1).border_color(C.line);
    if (sh && !sh.flash) root.opacity(0.78 + 0.22 * (1 - power));

    const n = this.items.length;
    const surge = sh && power > 0.6;
    const spread = (t) => [...String(t)].join("\u2009");
    const vessel = up(((location().cwd ?? "").split("/").filter(Boolean).pop()) ?? "UNKNOWN");
    const inv = (label, value, col = C.mid) => h_flex().gap(10).items_baseline()
      .child(div().w(54).flex_none().text_size(10).font_semibold().text_color(C.lo).child(label))
      .child(div().flex_1().truncate().text_size(12).text_color(col).child(glitch(value, label.length)));
    const booting = this.bootStep <= BOOT.length;

    root.child(row(v_flex().gap(3)
      .child(txt(surge ? "!! POWER SURGE // BUS 4 !!" : "WEYLAND-YUTANI CORP // NOSTROMO 180246", surge ? C.hi : C.lo, 10, 1))
      .child(h_flex().items_center().gap(6)
        .child(div().font_semibold().text_size(15).text_color(C.hi).child(glitch(spread("READY FOR INQUIRY"), 2)))
        .child(cursor())), 1));

    if (booting) {
      const lines = v_flex().gap(3).pt(6);
      BOOT.slice(0, this.bootStep).forEach((l, i) => lines.child(txt(`> ${l}`, i === this.bootStep - 1 ? C.hi : C.mid, 12, 20 + i)));
      return root.child(lines);
    }

    // The "foreshadowing inventory": a plain card of facts before the work.
    if (this.state === "ok") {
      const top = this.items[0];
      root.child(row(v_flex().gap(3).p(8).border(1).border_color(C.line)
        .child(inv("VESSEL", vessel, C.hi))
        .child(inv("CREW", `${String(n).padStart(3, "0")} READY`))
        .child(inv("CARGO", `${String(this.blocked.length).padStart(3, "0")} BLOCKED`))
        .child(inv("NEXT", top ? up(top.title) : "NONE", C.hi)), 3));
    } else root.child(txt("> QUEUE: ---", C.mid, 12, 3));

    if (this.state === "loading") return root.child(h_flex().gap(6).child(txt("> STAND BY", C.mid)).child(cursor()));
    if (this.state !== "ok") {
      return root.child(v_flex().gap(4).p(8).border(1).border_color(C.mid).bg(C.panel)
        .child(div().font_semibold().text_color(C.hi).child(this.state === "error" ? "!! SYSTEM FAULT !!" : "!! NO CONNECTION !!"))
        .child(txt(up(this.info), C.mid, 12)));
    }
    if (!n && !this.blocked.length) return root.child(txt("> NO ACTIONABLE ENTRIES. ALL QUIET.", C.mid));

    // ---- the dependency graph -------------------------------------------------
    const byId = new Map();
    for (const it of this.items) byId.set(it.id, { ...it, ready: true });
    for (const it of this.blocked) byId.set(it.id, { ...it, ready: false });
    const dependents = new Map(); // id -> beads that wait on it
    for (const b of this.blocked) for (const dep of b.blocked_by ?? []) {
      if (!dependents.has(dep)) dependents.set(dep, []);
      dependents.get(dep).push(b);
    }
    const downstream = (id) => { // everything transitively released by finishing id
      const seen = new Set(), stack = [id];
      while (stack.length) for (const d of dependents.get(stack.pop()) ?? []) if (!seen.has(d.id)) { seen.add(d.id); stack.push(d.id); }
      return seen.size;
    };

    const badge = (p) => {
      const el = div().px(6).text_size(11).font_semibold().child(p === null ? "PRI ?" : `PRI ${p}`);
      if (p === 0) return el.bg(C.hi).text_color(C.ink);
      if (p === 1) return el.bg(C.mid).text_color(C.ink);
      if (p === 2) return el.border(1).border_color(C.mid).text_color(C.mid);
      return el.border(1).border_color(C.lo).text_color(C.lo);
    };
    // Ron Cobb's "semiotic standard": a pictogram in a rounded rectangle per bead type.
    const typeIcon = (type, col) => h_flex().w(22).h(22).flex_none().rounded(6).border(1).border_color(col).items_center().justify_center()
      .child(svg(`mods/beads-ready/icons/${TYPE_ICONS.has(type) ? type : "other"}.svg`).size(14).text_color(col));
    const edge = (last) => (last ? "└─" : "├─");
    const short = (s, k = 34) => (String(s).length > k ? String(s).slice(0, k - 1) + "…" : String(s));

    let rowNo = 10;
    const card = (it, ready) => {
      const p = Number.isFinite(it.priority) ? it.priority : null;
      const meta = [it.issue_type && `TYPE:${up(it.issue_type)}`, it.assignee && `OPR:${up(it.assignee)}`, it.updated_at && `T-${up(ago(it.updated_at))}`].filter(Boolean).join("   ");
      const ri = (rowNo += 12);
      const down = ready ? downstream(it.id) : 0;
      const el = v_flex().id(`bead-${it.id}`).gap(4).p(8).bg(C.panel)
        .border(1).border_color(ready ? C.lo : C.dim)
        .cursor_pointer()
        .hover((s) => s.border_color(C.hover).bg(C.hoverBg))
        .on_click(() => this.openBead(it.id))
        .child(h_flex().items_center().gap(8)
          .child(typeIcon(it.issue_type, ready ? C.mid : C.lo))
          .child(badge(p))
          .child(div().flex_1().truncate().text_size(11).text_color(C.lo).child(glitch(up(it.id), ri)))
          .when(down > 0, (h) => h.child(div().text_size(11).text_color(C.mid).child(`▸ UNLOCKS ${down}`))))
        .child(div().text_color(ready ? C.hi : C.lo).child(glitch(it.title ?? "", ri + 1)));
      if (meta) el.child(txt(meta, C.lo, 11, ri + 2));

      // edges: a ready card lists what it releases; a blocked card lists what it waits on
      const links = ready
        ? (dependents.get(it.id) ?? []).map((d) => ({ d, note: (d.blocked_by?.length ?? 0) > 1 ? `+${d.blocked_by.length - 1} MORE` : "LAST BLOCKER" }))
        : (it.blocked_by ?? []).map((id) => ({ d: byId.get(id) ?? { id, title: id }, note: byId.get(id) ? (byId.get(id).ready ? "READY" : "BLOCKED") : "ACTIVE" }));
      if (links.length) {
        const shown = links.slice(0, 4);
        el.child(div().h(1).bg(C.dim));
        el.child(txt(ready ? "RELEASES / LIBÈRE" : "WAITS ON / ATTEND", C.lo, 10, ri + 3));
        shown.forEach((l, k) => {
          const last = k === shown.length - 1 && links.length <= 4;
          el.child(h_flex().id(`edge-${it.id}-${l.d.id}`).gap(6).items_center().cursor_pointer()
            .hover((s) => s.bg(C.hoverBg))
            .on_click((_e, cx) => { cx.stop_propagation(); this.openBead(l.d.id); })
            .child(div().text_size(12).text_color(C.lo).child(edge(last)))
            .child(div().flex_1().truncate().text_size(12).text_color(C.mid).child(glitch(short(l.d.title), ri + 4 + k)))
            .child(div().text_size(10).text_color(l.note === "READY" || l.note === "LAST BLOCKER" ? C.hi : C.lo).child(l.note)));
        });
        if (links.length > 4) el.child(txt(`└─ +${links.length - 4} MORE`, C.lo, 11, ri + 9));
      }
      return row(el, ri);
    };

    const list = v_flex().id("beads-list").flex_1().overflow_y_scrollbar().gap(6);
    for (const it of this.items) list.child(card(it, true));
    if (this.blocked.length) {
      // A labelled, framed bay: hazard strip, inverse title bar, double rule.
      const bay = v_flex().gap(6).mt(8).border(2).border_color(C.lo).p(6)
        .child(div().h(10).overflow_hidden().text_size(9).text_color(C.dim).child("▚".repeat(60)))
        .child(h_flex().items_center().justify_between().px(8).py(4).bg(C.lo)
          .child(div().text_size(11).font_semibold().text_color(C.ink).child(glitch("BLOCKED QUEUE / FILE BLOQUÉE", 5)))
          .child(div().text_size(11).font_semibold().text_color(C.ink).child(String(this.blocked.length).padStart(3, "0"))));
      for (const it of this.blocked) bay.child(card(it, false));
      list.child(bay);
    }
    root.child(list);
    return root.child(txt(`SPECIAL ORDER 937 // CREW EXPENDABLE // VIA ${up(this.runner === "toolbox" ? `TOOLBOX ${CFG.toolbox}` : "LOCAL")}`, C.dim, 10, 6));
  }
}
