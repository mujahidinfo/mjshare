/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false, // StrictMode double-invokes effects which can tear down live SSE/RTC connections in dev
  // Dev-only: allow cross-origin dev asset requests from any host (e.g. opening
  // the app by LAN IP on another device). Loosen freely here — this has no effect
  // on the production build.
  allowedDevOrigins: ['*'],
};

module.exports = nextConfig;
