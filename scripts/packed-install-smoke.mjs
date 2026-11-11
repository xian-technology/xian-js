import { execFileSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const installRoot = mkdtempSync(join(tmpdir(), "xian-js-packed-"));
const cacheRoot = join(installRoot, "npm-cache");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

function runNpm(args, cwd) {
  return execFileSync(npm, [...args, "--cache", cacheRoot], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

try {
  const tarballs = ["types", "client", "provider"].map((name) => {
    const packed = JSON.parse(runNpm([
      "pack", "--json", "--pack-destination", installRoot
    ], join(root, "packages", name)));
    return join(installRoot, packed[0].filename);
  });
  writeFileSync(join(installRoot, "package.json"), JSON.stringify({ private: true, type: "module" }));
  // Resolve packed manifest ranges as a standalone consumer, without a warm cache.
  runNpm([
    "install", "--package-lock", "--ignore-scripts", "--no-audit", "--no-fund", ...tarballs
  ], installRoot);
  console.log(JSON.stringify({ consumerLock: JSON.parse(
    readFileSync(join(installRoot, "package-lock.json"), "utf8")
  ) }));
  copyFileSync(join(root, "scripts/fixtures/packed-nonce-smoke.mjs"), join(installRoot, "smoke.mjs"));
  execFileSync(process.execPath, ["smoke.mjs"], { cwd: installRoot, stdio: "inherit" });
} finally {
  rmSync(installRoot, { recursive: true, force: true });
}
