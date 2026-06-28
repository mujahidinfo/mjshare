const os = require('os');

// Collect this machine's current LAN IPv4 addresses at startup so the dev
// server trusts them no matter which WiFi network we're on.
function localIPv4s() {
  const out = [];
  for (const iface of Object.values(os.networkInterfaces())) {
    for (const net of iface || []) {
      if (net.family === 'IPv4' && !net.internal) out.push(net.address);
    }
  }
  return out;
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false, // StrictMode double-invokes effects which can tear down live SSE/RTC connections in dev
  // Dev-only: allow cross-origin dev asset requests from any host (e.g. opening
  // the app by LAN IP on another device). Loosen freely here — this has no effect
  // on the production build.
  allowedDevOrigins: [
    ...localIPv4s(),
    // Wildcards for the common private subnet ranges, so a new WiFi network
    // (and its new IP) is trusted without editing this file.
    '192.168.*.*',
    '10.*.*.*',
    '172.16.*.*',
  ],
};

module.exports = nextConfig;
