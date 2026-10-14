#!/bin/bash
# Desktop stack (runs as the desktop user): virtual X + MATE (PwnBox HTB
# edition) + VNC on 5901.
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
for i in $(seq 1 100); do
    [ -e /tmp/.X11-unix/X99 ] && break
    sleep 0.1
done

# Fresh PwnBox on every boot: drop the user dconf DB so the HackTheBox system
# defaults (theme, icons, wallpaper, panel layout from parrot-core-htb) always
# apply — otherwise MATE persists its own values over them on first login.
rm -rf "$HOME/.config/dconf"

dbus-launch --exit-with-session mate-session &

exec x11vnc \
    -display :99 \
    -rfbport 5901 \
    -passwd "$VNC_PW" \
    -forever -shared \
    -noxdamage -noxrecord -xkb
