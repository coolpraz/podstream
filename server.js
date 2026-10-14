#!/usr/bin/env node
'use strict';

/**
 * PodStream — a minimal, Kasm-style "desktops in the browser" manager for Podman.
 *
 *   browser --WebSocket(RFB)--> PodStream server --TCP--> VNC server inside the container
 *
 * Sessions are plain Podman containers. Each container's raw VNC port is published
 * on 127.0.0.1 only; all client traffic is proxied through this server's WebSocket
 * endpoint (/ws/vnc/<id>), so no VNC port is ever exposed to the network.
 *
 * Entry point only — the implementation lives under src/ (see README "Project layout").
 */

const { start } = require('./src/start');

start();
