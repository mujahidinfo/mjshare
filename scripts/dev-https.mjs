#!/usr/bin/env node
/**
 * pnpm dev:https — run mjshare over HTTPS for two-device LAN testing.
 *
 * WebRTC only runs in a secure context. `localhost` is exempt, but the LAN URL a
 * second device opens (http://192.168.x.x:3000) is NOT — browsers block P2P there.
 * This script uses mkcert to mint a locally-trusted cert covering localhost + your
 * LAN IP, then boots the custom server (server.js) over HTTPS with it.
 *
 * Requires mkcert: https://github.com/FiloSottile/mkcert
 *   macOS:   brew install mkcert nss
 *   Linux:   sudo apt install libnss3-tools && <install mkcert binary>
 *   Windows: choco install mkcert   (or scoop install mkcert)
 */

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const certDir = join(root, "certs");
const certFile = join(certDir, "cert.pem");
const keyFile = join(certDir, "key.pem");
const port = process.env.PORT || "3000";

function fail(msg) {
  console.error(`\n  ✖ ${msg}\n`);
  process.exit(1);
}

/** Best-effort detection of the primary non-internal IPv4 address. */
function lanIp() {
  const ifaces = networkInterfaces();
  for (const list of Object.values(ifaces)) {
    for (const ni of list ?? []) {
      if (ni.family === "IPv4" && !ni.internal) return ni.address;
    }
  }
  return null;
}

const ip = lanIp();
const hosts = ["localhost", "127.0.0.1", "::1", ...(ip ? [ip] : [])];
const haveCert = existsSync(certFile) && existsSync(keyFile);

// 1. Generate the cert with mkcert if we don't already have one. (If certs are
//    already present we skip mkcert entirely, so it isn't required to re-run.)
if (!haveCert) {
  const probe = spawnSync("mkcert", ["-CAROOT"], { encoding: "utf8" });
  if (probe.error) {
    fail(
      "mkcert not found on PATH.\n\n" +
        "  Install it, then re-run `pnpm dev:https`:\n" +
        "    macOS:   brew install mkcert nss\n" +
        "    Linux:   sudo apt install libnss3-tools  (then install the mkcert binary)\n" +
        "    Windows: choco install mkcert\n\n" +
        "  Docs: https://github.com/FiloSottile/mkcert#installation"
    );
  }

  mkdirSync(certDir, { recursive: true });

  console.log("\n  • Installing mkcert local CA (you may be prompted for a password)…");
  const install = spawnSync("mkcert", ["-install"], { stdio: "inherit" });
  if (install.status !== 0) {
    console.warn(
      "  ! `mkcert -install` did not complete cleanly. The cert will still be\n" +
        "    generated; you may just see a browser trust warning you can click through."
    );
  }

  console.log(`  • Generating certificate for: ${hosts.join(", ")}`);
  const gen = spawnSync(
    "mkcert",
    ["-cert-file", certFile, "-key-file", keyFile, ...hosts],
    { stdio: "inherit" }
  );
  if (gen.status !== 0 || !existsSync(certFile)) {
    fail("mkcert failed to generate the certificate.");
  }
} else {
  console.log(`\n  • Reusing existing certificate in ./certs`);
}

// 2. Boot the custom server over HTTPS.
console.log(`  • Starting mjshare over HTTPS on port ${port}\n`);
if (ip) {
  console.log(`    Open on this machine:  https://localhost:${port}`);
  console.log(`    Open on other devices: https://${ip}:${port}`);
  console.log(
    `    (On a phone, either install mkcert's root CA or tap through the trust warning —\n` +
      `     proceeding still yields a secure https:// context, which is all WebRTC needs.)\n`
  );
}

const child = spawn("node", ["server.js"], {
  cwd: root,
  stdio: "inherit",
  env: {
    ...process.env,
    HOST: process.env.HOST || "0.0.0.0",
    PORT: port,
    SSL_CERT: certFile,
    SSL_KEY: keyFile,
    // leave NODE_ENV unset -> Next dev mode
  },
});

const forward = (sig) => child.kill(sig);
process.on("SIGINT", () => forward("SIGINT"));
process.on("SIGTERM", () => forward("SIGTERM"));
child.on("exit", (code) => process.exit(code ?? 0));
