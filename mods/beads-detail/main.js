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
import { exec, props, closeOverlay, appHome, writeTextFile, readTextFile, notify } from "herdr";

// Detail dialog for one bead, opened by the beads-ready panel. Props: { id, cwd, on, overlay }.
const TOOLBOX = "code"; // keep in sync with beads-ready; the panel passes which runner it picked
// Workaround: ~/.config/environment.d/beads-dolt.conf (removed) leaked a shared-Dolt-server setup into this app's
// environment. Run the local beads without it so it uses the project's own .beads database.
const UNSET = ["BEADS_DOLT_SHARED_SERVER", "BEADS_DOLT_SERVER_HOST", "BEADS_DOLT_SERVER_PORT", "BEADS_DOLT_SERVER_USER", "BEADS_DOLT_AUTO_START"].flatMap((v) => ["-u", v]);
const cmdFor = (runner, args) => (runner === "toolbox" ? ["toolbox", ["run", "-c", TOOLBOX, "beads", ...args]] : ["env", [...UNSET, "beads", ...args]]);
const C = { bg: "#000000", panel: "#060906", hi: "#f4f1e8", mid: "#9bcd9b", lo: "#698b69", dim: "#3d553d", line: "#698b69", ink: "#000000", hover: "#ffa500", hoverBg: "#0d140d" };
// Fonts after the film (typesetinthefuture.com/2014/12/01/alien): Helvetica clone for labels, a serif for MU/TH/UR's words.
const readTextFileSafe = (p) => readTextFile(p);
const FONT = "Nimbus Sans";
const FONT_SERIF = "Noto Serif";
const FONT_MONO = "JetBrains Mono";

// The sentinel the button spawns (`vega mux spawn`). Claude bypasses permission prompts by vega's default args,
// so the button asks first. --no-parent: the click has no parent agent pane to report back to.
const SENTINEL = { kind: "claude", tier: "balanced" };
const up = (x) => String(x ?? "").toUpperCase();

function parseJson(text) {
  const i = text.search(/[\[{]/);
  if (i < 0) return null;
  try { return JSON.parse(text.slice(i)); } catch { return null; }
}

export default class BeadsDetail extends View {
  init(p, cx) {
    this.handle = cx.focus_handle();
    this.handle.focus();
    this.trail = [];
    this.bead = null;
    this.error = null;
    const id = props()?.id ?? p?.id;
    if (id) this.load(id, cx);
    else { this.error = "No record selected"; }
  }

  load(id, cx, push = false) {
    const { cwd, on, runner } = props() ?? {};
    if (push && this.bead) this.trail.push(this.bead.id);
    this.loading = id; this.error = null; this.armed = false; this.spawnState = null; this.spawnMsg = "";
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        const r = await exec(...cmdFor(runner, ["show", id, "--json"]), { cwd, on });
        const data = parseJson(r.stdout);
        const b = Array.isArray(data) ? data[0] : data;
        if (b && b.id) {
          // The full hierarchy: everything it transitively waits on (down) and releases (up).
          const tree = async (dir) => {
            try {
              const t = await exec(...cmdFor(runner, ["dep", "tree", id, "--direction", dir, "--json"]), { cwd, on });
              const rows = parseJson(t.stdout);
              return Array.isArray(rows) ? rows : [];
            } catch { return []; }
          };
          [b.treeDown, b.treeUp] = await Promise.all([tree("down"), tree("up")]);
          this.bead = b; this.error = null;
        }
        else this.error = (data && data.error) || r.stderr.split("\n").find((l) => l.trim() && !l.startsWith("warning:")) || `Cannot read ${id}`;
      } catch (e) { this.error = String(e); }
      this.loading = null;
      cx.notify();
    });
  }

  // ---- spawn a vega sentinel for the open bead --------------------------------
  brief(b) {
    const deps = (b.treeDown ?? []).filter((r) => r.depth === 1).map((r) => `${r.id} (${r.title})`).join("; ") || "none";
    return [
      `You are a sentinel for bead ${b.id}: ${b.title}`,
      "",
      `Priority: P${b.priority ?? "?"}  Type: ${b.issue_type ?? "?"}  Status: ${b.status ?? "?"}`,
      `Waits on: ${deps}`,
      "",
      b.description ? `Description:\n${b.description}\n` : "",
      b.design ? `Design:\n${b.design}\n` : "",
      b.acceptance_criteria ? `Acceptance criteria:\n${b.acceptance_criteria}\n` : "",
      b.notes ? `Notes:\n${b.notes}\n` : "",
      "Rules:",
      `- Read the full record first: \`bd show ${b.id}\` (or \`beads show ${b.id}\`).`,
      `- Claim it before you start: \`bd update ${b.id} --claim\`.`,
      "- Work on this bead only. Do not touch other beads or unrelated files.",
      `- When it is done, close it (\`bd close ${b.id}\`) and give a short summary of what changed.`,
      "- If you are blocked or the bead is unclear, stop and ask the user in this pane.",
      "",
    ].filter((l) => l !== "").join("\n");
  }

  spawn(cx) {
    const b = this.bead;
    if (!b || this.spawnState === "running") return;
    const { cwd, on } = props() ?? {};
    this.spawnState = "running"; this.spawnMsg = ""; this.armed = false;
    cx.notify();
    cx.spawn(async (cx) => {
      let ok = false, msg = "";
      try {
        const dir = `${appHome()}/data/beads-sentinel`;
        await exec("mkdir", ["-p", dir]);
        const file = `${dir}/${b.id}.md`;
        let prev = null;
        try { prev = await readTextFileSafe(file); } catch {}
        await writeTextFile(file, this.brief(b), prev);
        const name = `sentinel-${b.id.split("-").pop().toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 12) || "x"}`;
        const args = ["mux", "spawn", name, "--kind", SENTINEL.kind, "--tier", SENTINEL.tier, "--no-parent", "--prompt-file", file];
        if (cwd) args.push("--cwd", cwd);
        if (on) args.push("--machine", on);
        // vega on this machine first; the toolbox only if the local one cannot run.
        const attempts = [["vega", args], ...(TOOLBOX && !on ? [["toolbox", ["run", "-c", TOOLBOX, "vega", ...args]]] : [])];
        let last = null;
        for (const [cmd, a] of attempts) {
          let r = null;
          try { r = await exec(cmd, a, { cwd, on }); } catch (e) { last = { code: 127, stderr: String(e), stdout: "" }; continue; }
          last = r;
          if (r.code === 0) { ok = true; break; }
          if (!/GLIBC|not found|command not found/i.test(`${r.stderr}${r.stdout}`)) break; // a real vega error: do not retry elsewhere
        }
        const text = `${last?.stdout ?? ""}\n${last?.stderr ?? ""}`.split("\n").map((l) => l.trim()).filter(Boolean);
        msg = ok ? (text[0] ?? `spawned ${name}`) : (text.find((l) => /error|message|hint|not/i.test(l)) ?? text[0] ?? "spawn failed");
        if (ok) notify({ title: "Sentinel spawned", body: `${name} for ${b.id}`, level: "success" });
        else notify({ title: "Sentinel not spawned", body: msg, level: "error" });
      } catch (e) { msg = String(e); notify({ title: "Sentinel not spawned", body: msg, level: "error" }); }
      this.spawnState = ok ? "done" : "failed"; this.spawnMsg = msg;
      cx.notify();
    });
  }

  back(cx) {
    const id = this.trail.pop();
    if (id) this.load(id, cx);
  }

  render(cx) {
    const b = this.bead;
    const label = (s) => div().text_size(10).text_color(C.lo).child(s);
    const field = (name, value) => (value ? v_flex().gap(2).child(label(name)).child(div().text_size(13).text_color(C.hi).child(String(value))) : null);
    const root = v_flex().id("beads-detail").track_focus(this.handle)
      .on_key_down((e, cx) => {
        if (e.key === "escape") closeOverlay(props()?.overlay);
        else if (e.key === "backspace") this.back(cx);
        else return;
        cx.stop_propagation();
      })
      .size_full().min_h(0).bg(C.bg).font_family(FONT).text_size(13).p(14).gap(10).border(1).border_color(C.line);

    root.child(h_flex().items_center().justify_between()
      .child(div().text_size(10).text_color(C.lo).child("MU/TH/UR 6000 // RECORD"))
      .child(h_flex().gap(8)
        .when(this.trail.length > 0, (h) => h.child(div().id("back").px(6).text_size(11).border(1).border_color(C.lo).text_color(C.mid).cursor_pointer()
          .hover((s) => s.border_color(C.hover)).on_click((_e, cx) => this.back(cx)).child("◂ BACK")))
        // An alien head, not an "X": it closes this view, not the bead. The tooltip says so.
        .child(h_flex().id("close").px(8).py(3).items_center().border(1).border_color(C.lo).text_color(C.mid).cursor_pointer()
          .tooltip("close view").accessibility_label("close view")
          .hover((s) => s.border_color(C.hover).text_color(C.hover)).on_click(() => closeOverlay(props()?.overlay))
          .child(svg("mods/beads-detail/alien.svg").w(40).h(20).flex_none()))));

    if (!b) {
      return root.child(div().text_color(this.error ? C.hi : C.mid).child(this.error ? `!! ${up(this.error)} !!` : "> STAND BY"));
    }

    const body = v_flex().id("detail-body").flex_1().overflow_y_scrollbar().gap(12);
    body.child(v_flex().gap(4)
      .child(h_flex().gap(8).items_center()
        .child(div().px(6).text_size(11).font_semibold().bg(b.priority === 0 ? C.hi : C.mid).text_color(C.ink).child(`PRI ${b.priority ?? "?"}`))
        .child(div().id("bead-id").px(4).text_size(11).cursor_pointer().text_color(this.copied ? C.hi : C.lo)
          .tooltip("copy bead id").accessibility_label("copy bead id")
          .hover((s) => s.text_color(C.hover))
          .on_click((_e, cx) => {
            cx.write_to_clipboard(b.id);
            this.copied = true; cx.notify();
            cx.timer.after(1400, (cx) => { this.copied = false; cx.notify(); });
          })
          .child(this.copied ? `✓ COPIED ${up(b.id)}` : up(b.id))))
      .child(div().text_size(18).text_color(C.hi).child(b.title ?? "")));

    // The sentinel button: a pixel skull, and a two-step "push / pull" confirmation like the Nostromo's scuttle panel.
    const sentinel = v_flex().gap(6)
      .child(h_flex().id("sentinel-btn").gap(10).items_center().px(10).py(6).border(1).border_color(C.mid).cursor_pointer()
        .hover((s) => s.border_color(C.hover).bg(C.hoverBg))
        .on_click((_e, cx) => { if (this.spawnState !== "running") { this.armed = !this.armed; cx.notify(); } })
        .child(svg("mods/beads-detail/skull.svg").w(30).h(22).flex_none().text_color(this.armed ? C.hover : C.hi))
        .child(v_flex().gap(1)
          .child(div().text_size(12).font_semibold().text_color(C.hi).child("SPAWN VEGA SENTINEL"))
          .child(div().text_size(10).text_color(C.lo).child("FOR THIS BEAD / POUR CE BEAD"))));
    if (this.armed) {
      sentinel.child(v_flex().gap(6).p(8).border(1).border_color(C.hover).bg(C.panel)
        .child(div().text_size(10).font_semibold().text_color(C.hover).child("VERIFY / VÉRIFIER"))
        .child(div().font_family(FONT_SERIF).text_size(12).text_color(C.mid).child(`Start a ${SENTINEL.kind} sentinel (${SENTINEL.tier}) with the brief for ${b.id}. Vega starts it without permission prompts.`))
        .child(h_flex().gap(8)
          .child(div().id("push").px(12).py(4).text_size(12).font_semibold().bg(C.hi).text_color(C.ink).cursor_pointer()
            .hover((s) => s.bg(C.hover)).on_click((_e, cx) => this.spawn(cx)).child("PUSH"))
          .child(div().id("pull").px(12).py(4).text_size(12).font_semibold().border(1).border_color(C.lo).text_color(C.mid).cursor_pointer()
            .hover((s) => s.border_color(C.hover)).on_click((_e, cx) => { this.armed = false; cx.notify(); }).child("PULL"))));
    }
    if (this.spawnState === "running") sentinel.child(div().text_size(12).text_color(C.hi).child("> ENGAGING…"));
    if (this.spawnState === "done") sentinel.child(div().text_size(12).text_color(C.mid).child(`> SENTINEL ONLINE: ${up(this.spawnMsg)}`));
    if (this.spawnState === "failed") sentinel.child(div().text_size(12).text_color(C.hi).child(`!! SPAWN FAILED: ${up(this.spawnMsg)} !!`));
    body.child(sentinel);

    const meta = v_flex().gap(8)
      .child(h_flex().gap(20).flex_wrap()
        .children([field("STATUS", up(b.status)), field("TYPE", up(b.issue_type)), field("OWNER", b.owner), field("ASSIGNEE", b.assignee)].filter(Boolean)))
      .child(h_flex().gap(20).flex_wrap()
        .children([field("CREATED", b.created_at), field("UPDATED", b.updated_at), field("LABELS", (b.labels ?? []).join(", "))].filter(Boolean)));
    body.child(meta);

    for (const [name, key] of [["DESCRIPTION", "description"], ["DESIGN", "design"], ["ACCEPTANCE CRITERIA", "acceptance_criteria"], ["NOTES", "notes"]]) {
      if (b[key]) body.child(v_flex().gap(3).child(label(name)).child(div().font_family(FONT_SERIF).text_size(13).text_color(C.mid).child(String(b[key]))));
    }

    // Flat rows (depth, parent_id) -> indented tree lines. A node reached by two paths shows once.
    const lines = (rows) => {
      const kids = new Map();
      for (const r of rows ?? []) if (r.depth > 0) { if (!kids.has(r.parent_id)) kids.set(r.parent_id, []); kids.get(r.parent_id).push(r); }
      const out = [];
      const walk = (pid, prefix) => {
        const list = kids.get(pid) ?? [];
        list.forEach((n, i) => {
          const last = i === list.length - 1;
          out.push({ n, prefix: prefix + (last ? "└─ " : "├─ ") });
          walk(n.id, prefix + (last ? "   " : "│  "));
        });
      };
      walk(b.id, "");
      return out;
    };
    const treeRow = ({ n, prefix }) => h_flex().id(`tree-${n.id}`).gap(6).items_center().px(4).py(2).cursor_pointer()
      .hover((s) => s.bg(C.hoverBg))
      .on_click((_e, cx) => this.load(n.id, cx, true))
      .child(div().font_family(FONT_MONO).text_size(12).text_color(C.lo).child(prefix))
      .child(div().px(5).text_size(10).font_semibold().border(1).border_color(C.mid).text_color(C.mid).child(`P${n.priority ?? "?"}`))
      .child(div().flex_1().truncate().text_size(13).text_color(n.status === "closed" ? C.lo : C.mid).child(n.title ?? n.id))
      .child(div().text_size(10).text_color(C.lo).child(up((n.truncated ? "… " : "") + (n.status ?? ""))));
    const down = lines(b.treeDown), upl = lines(b.treeUp);
    if (down.length) body.child(v_flex().gap(2).child(label(`WAITS ON / ATTEND // ${down.length} IN CHAIN`)).children(down.map(treeRow)));
    if (upl.length) body.child(v_flex().gap(2).child(label(`RELEASES / LIBÈRE // ${upl.length} IN CHAIN`)).children(upl.map(treeRow)));
    if (!down.length && !upl.length) body.child(div().text_size(12).text_color(C.lo).child("NO DEPENDENCY LINKS."));

    return root.child(body);
  }
}
