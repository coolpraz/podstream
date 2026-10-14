#!/bin/bash
# Desktop stack (runs as the desktop user): virtual X + BlackArch live-style
# Openbox UI (feh wallpaper, picom, tint2 panel, black/red theme) + VNC on 5901.
#
# Arch-in-container D-Bus notes (required, or GUI apps fail):
#   1. /etc/machine-id must exist        (created by start.sh as root)
#   2. XDG_RUNTIME_DIR must be set       (GDBus prefers it over autolaunch)
#   3. start the session daemon explicitly (dbus-launch's bus dies on Arch)
#   4. WAIT until X actually accepts connections before launching anything —
#      Arch's Xvfb initializes slower than Debian's, and racing it kills the
#      container (x11vnc is PID 1).
set -e

: "${VNC_RESOLUTION:=1600x900}"
: "${VNC_PW:=headless}"
export DISPLAY=:99
export HOME=/home/user
export USER=user
export LOGNAME=user
export SHELL=/bin/bash
export XDG_CONFIG_HOME=/home/user/.config
export XDG_CACHE_HOME=/home/user/.cache
export XDG_DATA_HOME=/home/user/.local/share
export XDG_RUNTIME_DIR=/tmp/xdg-user
mkdir -p "$XDG_CONFIG_HOME" "$XDG_CACHE_HOME" "$XDG_DATA_HOME" "$XDG_RUNTIME_DIR"
chmod 700 "$XDG_RUNTIME_DIR"

Xvfb :99 -screen 0 "${VNC_RESOLUTION}x24" -nolisten tcp &

for i in $(seq 1 120); do
    if xdpyinfo >/dev/null 2>&1; then break; fi
    sleep 0.5
done

ADDR=/tmp/.podstream-dbus-addr
rm -f "$ADDR"
dbus-daemon --session --fork --print-address=6 --print-pid=7 6>"$ADDR" 7>/dev/null
export DBUS_SESSION_BUS_ADDRESS=$(cat "$ADDR")

# BlackArch live-style look: wallpaper, compositor, black/red tint2 panel
feh --bg-scale /usr/share/blackarch/wallpaper.png 2>/dev/null || true

openbox-session >/tmp/openbox.log 2>&1 &
sleep 1
picom --daemonize >/dev/null 2>&1 || true

TINT2RC="$XDG_CONFIG_HOME/tint2/tint2rc"
mkdir -p "$(dirname "$TINT2RC")"
cat > "$TINT2RC" <<'TINT2'
# BlackArch-style tint2 panel
rounded = 0
border_width = 1
border_sides = TBLR
background = yes
id = 1
background_color = #000000 85
border_color = #bb0000 100
rounded = 2
background = yes
id = 2
background_color = #1a1a1a 60
border_color = #bb0000 60
border_width = 0
rounded = 2
background = yes
id = 3
background_color = #bb0000 60
border_color = #ff2222 100
border_width = 1

panel_items = TSC
panel_position = bottom center horizontal
panel_size = 100% 28
panel_margin = 0 0 0
panel_padding = 4 0 4
panel_dock = 0
panel_window_type = dock
panel_background_id = 1
panel_layer = top

taskbar_mode = multi_desktop
taskbar_name = 1
taskbar_name_font = sans bold 9
taskbar_name_font_color = #eeeeee 100
taskbar_background_id = 2
task_icon_asb = 80 0 -10
task_background_id = 0
task_font = sans 9
task_font_color = #eeeeee 100
task_active_background_id = 3
task_centered = 1

systray_padding = 4 2 4
systray_background_id = 2
systray_sort = left2right
systray_icon_size = 18

time1_format = %H:%M
time1_timezone = :UTC
clock_font = sans 9
clock_font_color = #eeeeee 100
clock_padding = 2 0
clock_background_id = 2
TINT2
tint2 -c "$TINT2RC" >/tmp/tint2.log 2>&1 &

# Same X-ready idea for x11vnc: it must find a live display when it starts.
for i in $(seq 1 120); do
    if xdpyinfo >/dev/null 2>&1; then break; fi
    sleep 0.5
done

exec x11vnc \
    -display :99 \
    -rfbport 5901 \
    -passwd "$VNC_PW" \
    -forever -shared \
    -noxdamage -noxrecord -xkb
