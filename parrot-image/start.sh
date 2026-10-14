#!/bin/bash
# Entrypoint (runs as root): re-exec the desktop stack as the desktop user.
set -e

: "${VNC_RESOLUTION:=1600x900}"
: "${VNC_PW:=headless}"
: "${DESKTOP_USER:=user}"

# Cockpit web console (terminal + system apps) on 9090 — proxied by PodStream.
# Runs as root so PAM login works for any user of the instance.
if [ -x /usr/lib/cockpit/cockpit-ws ]; then
    /usr/lib/cockpit/cockpit-ws --no-tls --port 9090 >/tmp/cockpit-ws.log 2>&1 &
elif command -v cockpit-ws >/dev/null 2>&1; then
    cockpit-ws --no-tls --port 9090 >/tmp/cockpit-ws.log 2>&1 &
fi


exec runuser -u "$DESKTOP_USER" -- \
    env HOME="/home/$DESKTOP_USER" \
        USER="$DESKTOP_USER" \
        LOGNAME="$DESKTOP_USER" \
        DISPLAY=:99 \
        VNC_RESOLUTION="$VNC_RESOLUTION" \
        VNC_PW="$VNC_PW" \
    /bin/bash /start-desktop.sh
