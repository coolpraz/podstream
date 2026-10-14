# PodStream

A minimal, self-hosted, Kasm-style **desktops in the browser** manager for **Podman**.
Pick a desktop template, click Launch, and the container's screen is streamed to your
browser — keyboard, mouse, clipboard and all.

```
browser ──WebSocket(RFB)──> PodStream server ──TCP──> VNC server inside the container
                            (Node + Express)          (published to 127.0.0.1 only)
```

- Sessions are **plain Podman containers** — no daemon, works rootless.
- Streaming is **noVNC over WebSocket**, proxied through the app. No VNC port is ever
  exposed to the network.
- First usable version in ~150 lines of frontend + ~400 of backend. No database.

## Requirements

- Linux with **Podman** (`podman --version`) — rootless is fine
- **Node.js ≥ 18**

## Project layout

```
server.js            entry point — boots src/start.js
src/
  config.js          env vars, deploy plans, project-root path
  state.js           shared in-memory state (sessions, labs, runtime)
  templates.js       app templates: defaults, load/persist (templates.local.json)
  sessions.js        session lifecycle: launch, stop, reconcile, adoption
  labs.js            lab networks: pods, targets, reconcile, adoption
  images.js          image listing (grouped by ID) + guarded removal
  marketplace.js     quay.io listing + background pulls
  cockpit.js         Cockpit edge resolution for the proxy
  console-session.js web-terminal bridging (node-pty, script fallback)
  ws.js              upgrade routing: /ws/vnc, /ws/term, /cockpit WS
  routes/api.js      /api/* router
  routes/cockpit.js  /cockpit/:id HTTP reverse proxy
  app.js             express app assembly (static, vendor mounts, routers)
  start.js           boot: podman check, adoption, reconcile loop, listen
  lib/               podman exec helpers, ports, ids, http helpers
test/                unit tests (node --test)
scripts/             quay-push.sh / quay-pull.sh registry helpers
public/              frontend (no build step): js/ ES modules + style.css
```

Frontend modules are plain browser ES modules — no bundler. `public/js/main.js`
is the entry; `router.js` maps pages, `pages/` renders them, `viewer.js` owns the
VNC/console tabs, `refresh.js` polls API state.

## Quickstart

```bash
cd podstream
npm install
npm start
# open http://localhost:3000
```

`templates.local.json` (if present) is loaded automatically and merged over the
default templates — this repo ships one with **Kali Linux** and **Parrot OS**.
Override with `TEMPLATES_FILE=/path/to/file.json`; entries with the same `id`
replace a default.

Click **Launch** on a template. The first launch pulls the image (can take a few
minutes); once the session shows **running**, click **Open**.

### Kali Linux & Parrot OS

Both are preconfigured via `templates.local.json` and built locally — real
distro theming, not generic desktops:

- **Kali** (`./kali-image`): Kali XFCE with `kali-defaults` theming/menu, the
  official wallpaper (xfconf defaults patched for Xvfb's monitor naming), running
  as user `kali` with zsh (`┌──(kali㉿kali)` prompt) and passwordless sudo.
- **Parrot** (`./parrot-image`): Parrot's own MATE stack (`parrot-core`,
  `echo-themes`, `ara`/`maia` icons, `parrot-menu`, `parrot-wallpapers`, brisk
  menu + panel applets) running as user `user` with Parrot's prompt. Debian's
  generic `mate-desktop-environment-core` alone renders a broken panel with no
  Parrot branding — don't skip the parrot packages.

The templates set `"hostname"` (`kali` / `parrot`) so prompts read
`kali@kali` / `user@parrot`, and both generate a fresh random VNC password per
session (passed via `VNC_PW`) — nothing to type, the browser fills it in
automatically. Tool set is a small curated list; install more inside a session
with `apt` (both rolling repos carry the full distro) or extend the
`Containerfile` and rebuild.

### Full-GUI, minimal-tools images (Kali / Parrot HTB / BlackArch)

The three main images are **full branded desktops with minimal preinstalled
tools** — the whole point is size. Each one: complete desktop + theming +
wallpapers + menus + the distro's own prompt/user setup, Firefox, and a VNC
stack. Tools are one command away in-session:

| Template | Image | Size | Install toolsets in-session |
|---|---|---|---|
| 🐉 Kali Linux | `localhost/podstream-kali-full` | ~2.4 GB | `sudo apt install kali-linux-default` (or `-large`, or individual tools) |
| 🦜 Parrot OS HTB (PwnBox) | `localhost/podstream-parrot-htb` | ~3 GB | `sudo apt install parrot-tools-full` (or individual metas) |
| 🏴 BlackArch Linux | `localhost/podstream-blackarch` | ~2.1 GB | `pacman -S blackarch-webapp blackarch-forensic …` (2,855 tools available) |

Multi-tab console: every **Console** button opens its desktop as a tab in the
viewer bar — switch between machines without reconnecting (background tabs stay
live), **⌄ Minimize** hides the viewer while sessions keep running, and the
floating pill restores it.

**Cockpit**: the three distro templates also run `cockpit-ws` inside the image
(port 9090, published on 127.0.0.1 like VNC and proxied at `/cockpit/<id>/`) —
the **Cockpit** button opens its full web console (terminal, system apps) in a
new tab. Log in with the instance's desktop user: `kali:kali`, `user:user`
(Parrot/BlackArch) or `root` via `sudo` inside the console. Templates opt in
with `"cockpit": true`; only newly deployed instances get the Cockpit edge.

```bash
podman build -f kali-image/Containerfile.full   -t podstream-kali-full   kali-image
podman build -f parrot-image/Containerfile.full -t podstream-parrot-htb  parrot-image
podman build -t podstream-blackarch blackarch-image
```

### Labs (multi-pod networks)

A **lab** is an isolated bridge network connecting multiple podman pods and
containers — real networking infrastructure: every pod gets its own IP on the
lab subnet, members resolve each other by name (aardvark-dns), and targets are
**never exposed to the host** — the only host-facing ports are the desktop
pods' VNC edges, proxied through PodStream.

Grow a lab from the UI: create it with a desktop pod, then **+ Desktop pod**
(any distro — e.g. PwnBox + a second Kali box) and **+ Target** (OWASP Juice
Shop `:3000`, DVWA `:80`, or any image). Desktops open into separate viewer
tabs; targets are reachable from any desktop by name or IP. Delete the lab to
remove the network and everything on it.

API: `GET/POST /api/labs`, `GET /api/labs/:id`,
`POST /api/labs/:id/desktops`, `POST /api/labs/:id/targets`,
`DELETE /api/labs/:id/members/:memberId`, `DELETE /api/labs/:id`;
the desktops stream through `/ws/vnc/<memberId>` like any session.

```bash
podman pod ps        # watch labs from the CLI
podman pod rm -f …   # (the UI Stop button does this)
```

**How well do pods suit an app like this?** Honestly assessed:

- **Great fit for labs.** One pod = one self-contained engagement: desktop +
  targets on a private localhost network, isolated from the host, torn down
  with a single `pod rm -f`. No port juggling, no docker-compose files.
- **Daemonless + rootless** is the big PodStream win: no Docker daemon as a
  single point of failure, and desktops run unprivileged by default.
- **A single desktop gains nothing from a pod** — pods exist for the
  multi-container case. That's why regular sessions don't create one.
- Limits to know: no GPU passthrough (heavy GPU tooling stays weak vs VMs),
  rootless networking (pasta/slirp4netns) adds throughput overhead, no live
  migration, and pods are single-node (no built-in clustering). Resource caps
  work via systemd slices if you need them.
- Verdict: podman pods are an excellent match for ephemeral, isolated,
  browser-streamed *lab sessions* — which is exactly what the Labs feature
  uses them for.

- The image replicates the **HTB PwnBox edition**: `parrot-core-htb` ships the
  HTB desktop definition as a dconf override that its installer activates — the
  image activates it at build time (`HackTheBox` GTK theme, `hackthebox` icons,
  `hackthebox.jpg` wallpaper, `Icy-Dark` window theme, dark transparent
  mate-terminal, the top/bottom panel layout with BriskMenu, multiload and
  launchers) and sets hostname `pwnbox`.
- dconf precedence gotcha: `parrot-skel` (the standard Parrot look) sorts AFTER
  `htb-config` alphabetically and would override it — the image activates the
  HTB file as `zzz-htb-config` so it wins, and drops the user dconf DB at every
  boot so each session starts as a fresh PwnBox.

### BlackArch notes

- The 53 `blackarch-*` category groups are purely organizational views over the
  same 2,857 tool packages (deduped total: ~26 GB). The slim image ships none of
  them preinstalled; `pacman -S blackarch-webapp …` pulls any category's tools
  and fills its menu groupings.
- ML/GPU/Java/Wine hogs (`python-pytorch`, `cuda`, `jdk-openjdk`, `rust`,
  `wine`…) are `--assume-installed` to skip their multi-GB cascades; add one
  back in-session with `pacman -S <pkg>` if a tool needs it.
- The UI replicates the **bootable BlackArch live session**: Openbox + tint2
  panel (black/red), picom, feh wallpaper, right-click root menu with the
  blackarch tool categories, `rxvt-unicode`/`urxvt`-style theming via
  `blackarch-config-openbox/gtk/icons/x11/bash`.
- Arch-in-container D-Bus requires three things the image handles for you:
  `/etc/machine-id` (generated at start), an explicit session
  `dbus-daemon` + `XDG_RUNTIME_DIR` (no `dbus-launch`), and a hand-started
  `xfconfd` — Xfce only — replaced by Openbox here. The start scripts also wait
  until X *actually accepts connections* before launching the WM/x11vnc —
  Arch's Xvfb initializes slower than Debian's, and `picom` must run
  `--daemonize` (foreground picom blocks the start script forever).

Build notes from a single-disk machine:

- **Bulk tool metas don't fit here.** `kali-linux-everything` (~38 GB image,
  60–90 GB build transient) and the full 53-group BlackArch (127 GB installed)
  both exceed this 216 GB disk with real data on it — several builds died at
  97–100% disk. Minimal-GUI images are the supported configuration; if you ever
  have ≥80 GB spare, re-add the tool metas to the Containerfiles.
- `kali.download` is pinned as the primary apt mirror with `http.kali.org` as
  fallback — the redirector intermittently serves broken mirrors.
- `podman rmi -f` on intermediate/parent images kills running containers — the
  GUI image-delete guard queries `podman ps -a --filter ancestor=<image>` and
  never force-removes.

> **Why not Kasm's own `kasmweb/*` images?** Their KasmVNC server is deliberately
> *not* RFB-compliant, so noVNC clients cannot talk to it ("KasmVNC does not
> follow the RFB specification, therefore legacy VNC clients will not work"). It
> also doesn't open port 5901 unless configured to. PodStream therefore builds
> plain `x11vnc`-based images instead.

### Push to quay.io (your own registry)

All three images can be uploaded to your quay.io account and pulled back later
on any machine — **one repository per distro**:

| Distro | quay repository |
|---|---|
| Kali | `quay.io/<ns>/podstream-kali:latest` |
| Parrot HTB | `quay.io/<ns>/podstream-parrot-htb:latest` |
| BlackArch | `quay.io/<ns>/podstream-blackarch:latest` |

1. **One-time login** (account password, or a robot-account token — robot login
   name is `<namespace>+<robotname>`):
   ```bash
   podman login quay.io
   ```
2. **Tag + push** (repositories auto-create on first push, private by default —
   flip to public in the quay UI under Repository Settings if you want
   anonymous pulls):
   ```bash
   scripts/quay-push.sh <your-quay-namespace> [repo-prefix] [distro]
   scripts/quay-push.sh myuser                     # all three (prefix: podstream)
   scripts/quay-push.sh myuser podstream kali      # only the Kali image
   ```
3. **Pull back later / on another machine:**
   ```bash
   scripts/quay-pull.sh <your-quay-namespace> [repo-prefix] [distro]
   ```
   Images are pulled and retagged as the `localhost/podstream-*` refs PodStream
   expects — sessions work immediately.

Robot accounts: quay.io → Account Settings → Robot Accounts → generate one per
machine; the token never expires and can be revoked from the web UI.

### Local images vs. pulls

Sessions use the image from local storage when it exists and only `podman pull`
when it doesn't. This avoids a multi-minute hang on `localhost/*` refs (podman
would probe a registry on localhost:5000 that isn't running) and keeps launches
working offline. To update an image: `podman pull <image>` (or rebuild + `podman
rmi` the old one) — sessions then use the new one immediately.

Templates included by default:

| Template | Image | Notes |
|---|---|---|
| Firefox | `accetto/ubuntu-vnc-xfce-firefox` | Firefox on XFCE |
| XFCE Desktop | `accetto/ubuntu-vnc-xfce` | Plain desktop |
| GIMP | `accetto/ubuntu-vnc-xfce-gimp` | GIMP on XFCE |
| Kali Linux | `localhost/podstream-kali` | Built from `./kali-image` (see below) |
| Parrot OS | `localhost/podstream-parrot` | Built from `./parrot-image` (see below) |
| Custom image | `localhost/podstream-example` | Built from `./example-image` (see below) |

accetto images use the public VNC password **`headless`** (the app fills it in
automatically).

### Build the example image (optional)

```bash
podman build -t podstream-example ./example-image
```

A minimal Debian 12 desktop: Xvfb + openbox + xterm + firefox-esr, VNC on 5901.
Unlike the Ubuntu-based images it uses real `firefox-esr` (no snap), so it also makes
a good base for your own images.

## Configuration (environment variables)

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | HTTP/WS listen port |
| `PODMAN_BIN` | `podman` | Podman binary path |
| `AUTH_TOKEN` | *(unset)* | If set, all API/WS calls require this token (the UI prompts for it once) |
| `SESSION_TTL_MINUTES` | `0` | Auto-stop sessions older than N minutes (`0` = never) |
| `MAX_SESSIONS` | `10` | Cap on concurrently active sessions |
| `TEMPLATES_FILE` | *(defaults)* | Path to a JSON file replacing the default templates |
| `PODSTREAM_INSECURE_SECCOMP` | `1` | `0` = drop `--security-opt seccomp=unconfined` (stricter, may break browsers in containers) |

### Custom templates

```bash
TEMPLATES_FILE=./templates.example.json npm start
```

```json
[
  {
    "id": "kali-xfce",
    "name": "Kali XFCE",
    "icon": "🐉",
    "description": "Kasmweb Kali image (experimental)",
    "image": "docker.io/kasmweb/kali-rolling-desktop:latest",
    "displayPort": 5901,
    "resolution": "1600x900",
    "vncPasswordEnv": "VNC_PW",
    "vncPassword": null,
    "env": {}
  }
]
```

- `displayPort` — the container-side **raw VNC** port (RFB), not a websockify/noVNC port.
- `vncPasswordEnv` — env var name the image uses for its VNC password. When
  `vncPassword` is `null`, a fresh random 8-char password is generated per session and
  passed via that env var (the UI fills it in automatically).
- `env` — any extra environment variables.
- `network` *(optional)* — passed as `podman run --network <value>`. The three main
  distro templates set `"network": "slirp4netns"` on purpose: rootless podman 5's
  default network stack (**pasta**) deliberately *mirrors the host interface into
  the container* — same interface name as your Wi-Fi/Ethernet adapter and the
  same IP address — while slirp4netns gives each desktop its own private
  `eth`/`tap0` address (`10.0.2.x`), so a pentest box never displays your host's
  identity. Handy for other images too, e.g.
  `"network": "pasta:--ns-ifname,eth0"` renames the interface while keeping
  pasta's speed.

Kasmweb images work through KasmVNC's RFB port 5901 (experimental; the fancy
KasmVNC web UI is not used).

## HTTP/WS API

| Endpoint | Description |
|---|---|
| `GET /api/health` | `{ ok, podman }` (no auth) |
| `GET /api/config` | templates + auth requirements (no auth) |
| `GET /api/sessions` | list sessions |
| `POST /api/sessions` | `{ "templateId": "xfce-firefox" }` → creates session |
| `DELETE /api/sessions/:id` | force-remove the container |
| `WS /ws/vnc/:id` | raw RFB tunnel to the container's VNC server |

## Security notes

- Container VNC ports are published on **127.0.0.1** only; browsers talk exclusively
  to the app's WebSocket endpoint.
- `AUTH_TOKEN` is optional but recommended whenever the app is reachable beyond
  localhost. It's a simple shared bearer token, not multi-user auth.
- The sessions API returns the VNC password to the browser — it travels over the same
  channel as the stream itself. Behind an SSH tunnel or reverse proxy with TLS this is
  fine for a homelab tool; add TLS/real auth if you expose it.
- `seccomp=unconfined` is applied to session containers by default (container browsers
  crash without it); set `PODSTREAM_INSECURE_SECCOMP=0` to disable.

## Troubleshooting

- **"podman not usable" banner** — the server can't exec `podman`; check `PODMAN_BIN`
  and that your user can run rootless podman.
- **Session stuck on *pulling*** — big first pull. Watch `podman images` / server logs;
  errors show up in the session card.
- **Auth failed in the viewer** — the image ignored `VNC_PW`; for accetto images the
  password is `headless`.
- **Firefox/Chrome crashes inside the desktop** — keep `--security-opt
  seccomp=unconfined` (default) and `--shm-size 1g` (always applied).
- **Sessions survive a server restart** — on boot the app adopts still-running
  `podstream-*` containers. Their VNC password is unknown afterwards, so the viewer
  will ask for it.
- **macOS/Windows (podman machine)** — works, since published ports are forwarded by
  the podman machine VM; Linux is the primary target though.

## Not (yet) in this basic version

Multi-user auth, GPU/audio, per-session uploads/downloading, session recording,
WebRTC (H.264) transport, persistence across restarts. All additive on the same
skeleton.
