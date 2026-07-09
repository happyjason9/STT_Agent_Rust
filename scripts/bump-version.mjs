#!/usr/bin/env node
// 同步更新版本號的所有出現位置：
//   - src-tauri/tauri.conf.json  (Tauri 打包實際讀取的版本，發布流程的來源)
//   - src-tauri/Cargo.toml
//   - src/App.tsx                (About 對話框顯示用的字串)
// 用法: node scripts/bump-version.mjs 1.9.0
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const newVersion = process.argv[2];

if (!newVersion || !/^\d+\.\d+\.\d+$/.test(newVersion)) {
  console.error("用法: node scripts/bump-version.mjs <版本號>  例如: node scripts/bump-version.mjs 1.9.0");
  process.exit(1);
}

// 1. tauri.conf.json
const tauriConfPath = join(root, "src-tauri/tauri.conf.json");
const tauriConf = JSON.parse(readFileSync(tauriConfPath, "utf-8"));
const oldVersion = tauriConf.version;
tauriConf.version = newVersion;
writeFileSync(tauriConfPath, JSON.stringify(tauriConf, null, 2) + "\n");
console.log(`✓ tauri.conf.json: ${oldVersion} -> ${newVersion}`);

// 2. Cargo.toml
const cargoTomlPath = join(root, "src-tauri/Cargo.toml");
let cargoToml = readFileSync(cargoTomlPath, "utf-8");
const cargoBefore = cargoToml;
cargoToml = cargoToml.replace(/^version = "[^"]+"/m, `version = "${newVersion}"`);
if (cargoToml === cargoBefore) {
  console.error("✗ 未能在 Cargo.toml 找到 version 欄位，請手動確認");
  process.exit(1);
}
writeFileSync(cargoTomlPath, cargoToml);
console.log(`✓ Cargo.toml: -> ${newVersion}`);

// 3. App.tsx 的 About 對話框版本字串
const appTsxPath = join(root, "src/App.tsx");
let appTsx = readFileSync(appTsxPath, "utf-8");
const appTsxBefore = appTsx;
appTsx = appTsx.replace(
  /(<strong>\{t\.version\}:<\/strong> )[\d.]+/,
  `$1${newVersion}`
);
if (appTsx === appTsxBefore) {
  console.error("✗ 未能在 App.tsx 找到版本顯示字串，請手動確認");
  process.exit(1);
}
writeFileSync(appTsxPath, appTsx);
console.log(`✓ App.tsx (About 對話框): -> ${newVersion}`);

// 4. 同步 Cargo.lock 內的版本鎖定
try {
  execSync("cargo check --offline --quiet", { cwd: join(root, "src-tauri"), stdio: "ignore" });
  console.log("✓ Cargo.lock 已同步");
} catch {
  console.warn("⚠ 無法自動同步 Cargo.lock（可能需要網路存取），請手動執行一次 `cargo check`");
}

console.log(`\n完成！所有位置已更新為 ${newVersion}。`);
console.log(`接下來：git add -A && git commit -m "版本 v${newVersion}" && git tag v${newVersion} && git push origin main --tags`);
