#!/bin/bash
# Start a virtual X desktop and expose it over VNC on 5901.
set -e

: "${VNC_RESOLUTION:=1440x900}"
: "${VNC_PW:=headless}"
export DISPLAY=:99

Xvfb :99 -screen 0 "${VNC_RESOLUTION}x24" -nolisten tcp &
for i in $(seq 1 50); do
    [ -e /tmp/.X11-unix/X99 ] && break
    sleep 0.1
done

# A window manager plus one visible app so the desktop isn't empty.
dbus-launch --exit-with-session openbox-session &
xterm -geometry 100x30+40+40 &

exec x11vnc \
    -display :99 \
    -rfbport 5901 \
    -passwd "$VNC_PW" \
    -forever -shared \
    -noxdamage -noxrecord -xkb
