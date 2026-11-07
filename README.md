# Nostromo Ready Beads — a MU/TH/UR terminal for your ready beads

A layout and two mods for the [herdr-app](https://herdr.dev) window. They hang a panel on the right that lists the
**ready [beads](https://github.com/steveyegge/beads)** of the project in the focused pane, drawn as the MU/TH/UR 6000
terminal from *Alien* (1979). Click a bead to see its full dependency chain, and spawn a vega sentinel for it.

![Nostromo Ready Beads](demo/beads-ready-panel.gif)

| Part | What it is |
| --- | --- |
| `layouts/main-beads.json` | The shipped `main` layout with the panel docked on the right. |
| `mods/beads-ready/` | The panel: ready beads, blocked queue, dependency edges. |
| `mods/beads-detail/` | The dialog it opens for one bead: record, full dependency tree, sentinel button. |

[`RECIPE.md`](RECIPE.md) describes all of it in enough detail to rebuild it from scratch.

## Features

- **Ready beads.** Runs `beads ready --json` and `beads blocked --json`, every 5 s and whenever the focused folder
  changes. Needs `beads` >= 1.3; if it is missing or older, the panel only shows an info box and does nothing else.
- **A graph, not a list.** Each ready bead shows `▸ UNLOCKS n` (everything it transitively releases) and a
  `RELEASES` tree. A framed **blocked queue** lists what each blocked bead `WAITS ON`.
- **Detail dialog.** Click a bead or any dependency row. It shows the record and the *full* chain in both directions
  (`beads dep tree`), every row clickable. `Backspace` or `◂ BACK` goes back, `Esc` closes. Click the bead id to copy
  it. The alien-head button closes the view (tooltip: *close view*).
- **Spawn vega sentinel** (only shown when `vega` is available). The skull button asks first (`PUSH` / `PULL`), then
  runs `vega mux spawn sentinel-<id> --kind claude --tier balanced --no-parent --prompt-file …` with a brief built from
  the bead. vega starts Claude without permission prompts, which is why there is a confirmation step.
- **Priority by weight, not hue.** Red, yellow, green and blue are kept for status.
- **The CRT takes a shock** now and then: tearing rows, corrupted glyphs, a flash.
  `herdr-app do beads-ready.shock` fires one on demand.

## Design

After the film, as described in
[Typeset in the Future: Alien](https://typesetinthefuture.com/2014/12/01/alien/):

- Helvetica for title cards and labels (set in *Nimbus Sans*, a Helvetica clone), a serif (*Noto Serif*) for
  MU/TH/UR's own words, mono (*JetBrains Mono*) for ids and tree lines. The fonts are not bundled; install them or
  herdr-app falls back to its default font.
- A "foreshadowing inventory" card (`VESSEL`, `CREW`, `CARGO`, `NEXT`) before the work.
- Ron Cobb's semiotic standard: a pictogram in a rounded rectangle for each bead type.
- English and French labels, as on the self-destruct panel (`RELEASES / LIBÈRE`, `WAITS ON / ATTEND`).
- A boot sequence on start, and a `PUSH` / `PULL` confirmation for the sentinel.
- Colours from [b4mad.industries](https://b4mad.industries/): black, sage `#698b69`, light sage `#9bcd9b`,
  cream `#f4f1e8`, orange on hover.

## Requirements

- [herdr-app](https://herdr.dev) with mod support (`herdr-app check`, `herdr-app do layout.switch`).
- `beads` (`bd`) >= 1.3 on the machine, or in a toolbox container (see *Configuration*).
- Optional, for the sentinel button: `vega` with its `mux` plugin.

## Install

```sh
git clone <this repo> && cd <this repo>
cp -r mods/beads-ready mods/beads-detail ~/.config/herdr-app/mods/
cp layouts/main-beads.json ~/.config/herdr-app/layouts/
herdr-app check ~/.config/herdr-app/mods/beads-ready
herdr-app check ~/.config/herdr-app/mods/beads-detail
herdr-app do layout.switch '{"name":"main-beads"}'
```

`layouts/main-beads.json` is a clone of herdr's `main` layout (version 0.1.13) plus one block. If your herdr's `main`
has moved on, clone it yourself and add the block instead:

```sh
herdr-app do layout.clone '{"name":"main","as":"main-beads"}'
```

```json
{ "id": "beads", "type": "block", "size": { "px": 320 }, "min": 220, "max": 700,
  "background": "surface", "radius": 10, "border": { "width": 1, "color": "border" },
  "content": { "mod": "beads-ready" } }
```

Add it to the `children` of `work-body`, after `panel`. The mods reload when you save.

## Configuration

Everything works without configuration. Optional settings go into
`~/.config/herdr-app/data/beads-ready/config.json` (read by both mods, re-read on every refresh):

```json
{
  "toolbox": "code",
  "unsetEnv": ["BEADS_DOLT_SHARED_SERVER", "BEADS_DOLT_SERVER_HOST", "BEADS_DOLT_SERVER_PORT"]
}
```

| Key | Meaning |
| --- | --- |
| `toolbox` | A toolbox container. When no suitable local `beads` (>= 1.3) or `vega` exists, it is run as `toolbox run -c <name> …`. |
| `unsetEnv` | Environment variables the local `beads` is started without (via `env -u`), **only for projects whose `.beads/metadata.json` has `dolt_mode: "embedded"`**; server-mode projects keep them. Use it when your environment points `beads` at a shared Dolt server but the project keeps its database in `.beads/`. |

A local `beads` is always tried first. Pin the panel to one folder (instead of the focused pane) with the mod prop
`{"cwd": "/path/to/project"}` in the layout block. The shock timing, the poll interval and the sentinel's `kind` and
`tier` are constants at the top of the `main.js` files.

## Limits

- It reads the beads of the **focused** pane's folder. Remote machines run `beads` there, without the toolbox fallback.
- The sentinel is started with `--no-parent`: a click has no parent agent pane to report back to, so `vegad` and
  `vega uac` do not track it.

## Sharing it

The repository is laid out for herdr's catalog: a layout, the mods it needs, a `RECIPE.md` and a `preview.png`. Put it
on GitHub with the topic `herdr-layout` (or `herdr-mod` for the mods alone) and it is listed at herdr.dev within the
hour.

## Credits

Visual ideas from *Alien* (20th Century Fox, 1979) and Dave Addey's
[Typeset in the Future](https://typesetinthefuture.com/2014/12/01/alien/). *Alien*, *Nostromo*, *MU/TH/UR* and
*Weyland-Yutani* belong to their owners; this project uses the names as homage only and is not affiliated with them.
Icons and artwork in this repository are original.

## License

Copyright © 2026 Christoph Görn

This program is free software: you can redistribute it and/or modify it under the terms of the
[GNU General Public License](LICENSE) as published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version. It is distributed in the hope that it will be useful, but
**without any warranty**; without even the implied warranty of merchantability or fitness for a particular
purpose. See the [LICENSE](LICENSE) file for details.

SPDX-License-Identifier: `GPL-3.0-or-later`
