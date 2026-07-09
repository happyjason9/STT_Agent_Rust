# STT Agent 交接文件

> 最後更新:2026-07-09
> 適用版本:v1.7.0
> 交接人:Jason(jason900524@gmail.com)

---

## 1. 專案概述

STT Agent 是提供公司內部同事**本地端使用**的桌面應用程式,用於醫療錄音檔的處理:轉檔、切割、消音(去識別化)、逐字稿與 AI 報告生成。

| 項目 | 內容 |
|------|------|
| 框架 | Tauri v2(Rust 後端 + WebView 前端) |
| 前端 | React 18 + TypeScript + Vite |
| 後端 | Rust(`src-tauri/`) |
| 外掛工具(sidecar) | FFmpeg(轉檔/消音)、Pandoc(Markdown 轉 Word) |
| 發布平台 | Windows(NSIS `_x64-setup.exe`)、Linux(deb) |
| 發布通路 | GitHub Releases(https://github.com/jasoncdc/STT_Agent_Rust) |

### 主要功能與對應程式

| 功能 | 前端頁面 | Rust 端 |
|------|---------|---------|
| 專案管理(建立工作資料夾結構) | `src/pages/WelcomePage.tsx` | `commands/project_cmd.rs`、`services/file_manager.rs` |
| 音檔轉 MP3 | `src/pages/ConvertPage.tsx` | `commands/audio_cmd.rs`、`services/converter.rs` |
| 音檔切割 | `src/pages/SplitPage.tsx` | `services/splitter.rs` |
| 手動消音 | `src/pages/SilencePage.tsx` | `services/silence.rs` |
| 批次逐字稿 + 自動消音 | `src/pages/SilenceAutoPage.tsx` | `commands/silence_cmd.rs`(需連 ASR 伺服器) |
| AI 報告生成(Gemini) | `src/pages/ReportPage.tsx` | `commands/report_cmd.rs`、`services/report.rs` |
| 音訊播放器 | (內嵌於各頁) | `commands/player_cmd.rs`、`services/audio_player.rs` |

---

## 2. 開發環境

### 需求

- Node.js 20+、Rust stable、系統依賴照 [Tauri v2 官方文件](https://v2.tauri.app/start/prerequisites/)
- 本機開發需準備 sidecar 執行檔放在 `src-tauri/`(檔名含 target triple,如 `ffmpeg-x86_64-unknown-linux-gnu`);CI 打包時會自動下載 Windows 版

### 常用指令

```bash
npm install          # 安裝前端依賴
npm run tauri dev    # 開發模式(熱重載)
npm run tauri build  # 本機打包
npx tsc --noEmit     # 前端型別檢查
```

---

## 3. 版本發布流程

1. 同步更新**兩處**版本號(必須一致):
   - `src-tauri/tauri.conf.json` → `version`
   - `src-tauri/Cargo.toml` → `version`
2. Commit 後打 tag 並推送:
   ```bash
   git tag v1.8.0        # tag 格式 v{版本號},會觸發 CI
   git push origin main --tags
   ```
3. GitHub Actions(`.github/workflows/build.yml`)自動:
   - 下載並以 **SHA256 驗證** FFmpeg / Pandoc sidecar(見 §5)
   - 建置、簽章(Tauri updater 簽章)並發布 Release,tag 為 `app-v{版本號}`
   - 產生 `latest.json`(自動更新用)
   - 計算安裝檔 SHA256,上傳 `SHA256SUMS.txt` 並寫入 Release 說明
4. 使用者端:舊版應用啟動時會檢查 `releases/latest/download/latest.json`,提示更新。

### GitHub Secrets(Repo → Settings → Secrets and variables → Actions)

| Secret | 用途 |
|--------|------|
| `TAURI_SIGNING_PRIVATE_KEY` | Tauri updater 簽章私鑰(`tauri signer generate` 產生的完整 Base64 字串) |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | 上述私鑰的密碼 |

**⚠️ 私鑰保管注意事項(交接重點):**

- 私鑰**遺失** → 之後的版本無法透過自動更新推送(公鑰寫死在 `tauri.conf.json` 的 `plugins.updater.pubkey`),只能請所有使用者手動重新安裝新簽發的版本。請將私鑰與密碼備份在公司的密碼管理系統。
- 私鑰**外洩** → 攻擊者可簽出會被所有既有使用者自動安裝的惡意更新,等同全面淪陷。若懷疑外洩,立刻重新產生金鑰對、更新 `pubkey`、換掉 GitHub Secrets,並通知使用者手動更新一次。
- 已知坑(前人踩過):產生金鑰時密碼要**手動輸入**不要貼上(Tauri 已知 bug);env 變數名是 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`(不是 `TAURI_SIGNING_KEY_PASSWORD`);`releaseDraft` 必須 `false` 否則 `/releases/latest/` 抓不到。

---

## 4. 外部服務與資料流

| 服務 | 資料流向 | 備註 |
|------|---------|------|
| Google Gemini API | 報告生成時,**音檔會上傳到 Google 雲端**(Files API),處理完程式會主動刪除雲端檔案 | API Key 由使用者自行輸入,只存在記憶體、不落地。UI 已加註警語 |
| ASR/NER 伺服器 | 批次逐字稿功能將音檔 POST 到使用者填的伺服器位址(預設 `http://127.0.0.1:8000`) | 伺服器端程式在 `ASR_NER_SERVER/`,**目前停滯、無人使用**(見 §6) |
| GitHub Releases | 自動更新檢查與下載 | HTTPS + 簽章驗證 |
| Gemini 定價頁 | 每日抓取一次定價快取到 app data dir | 僅顯示用 |

---

## 5. Sidecar(FFmpeg / Pandoc)升級方式

CI 內兩者皆為**固定版本 + SHA256 驗證**,任一不符 build 直接失敗。升級步驟:

1. 本機下載新版檔案,計算雜湊:
   - Linux/macOS:`sha256sum 檔案`
   - Windows:`Get-FileHash 檔案 -Algorithm SHA256`
2. 更新 `.github/workflows/build.yml` 內對應的 `$ffmpegVersion` / `$pandocVersion` 與 `$ffmpegSha256` / `$pandocSha256`。
3. FFmpeg 來源:gyan.dev 官方 Windows build(essentials 版已含本專案用到的 `libmp3lame`、`volume` filter、stream copy);Pandoc 來源:GitHub jgm/pandoc releases。

---

## 6. 資安檢查紀錄(2026-07-09)

由 Claude Code 對全專案做過一次資安盤點,結果與處理決策如下:

### 已確認安全的部分

- Repo 內無硬編碼金鑰/密碼;簽章私鑰只存在 GitHub Secrets。
- 自動更新走 HTTPS + minisign 簽章驗證,無法被中間人替換。
- FFmpeg/Pandoc 以參數陣列呼叫(非 shell 字串拼接),無指令注入。
- 前端有 CSP、無 `eval`/`dangerouslySetInnerHTML`;Tauri capabilities 僅開 `core/opener/dialog/updater`,前端無法直接執行 shell。
- `npm audit` 正式依賴 0 弱點(vite 的弱點僅影響開發環境,不進安裝檔)。

### 發現事項與處理狀態

| # | 事項 | 嚴重度 | 狀態 | 決策 |
|---|------|-------|------|------|
| 1 | CI 下載 sidecar 未固定版本、未驗證雜湊(供應鏈風險) | 高 | ✅ 已修(2026-07-09) | build.yml 改為固定版本 + SHA256 驗證 |
| 2 | 安裝檔無 Windows Authenticode 簽章,SmartScreen 會警告 | 中 | ✅ 以替代方案處理 | 不買憑證;Release 自動附 SHA256 供使用者比對(`SHA256SUMS.txt` + Release 說明) |
| 3 | `ASR_NER_SERVER/` 的 `/transcribe` 有路徑穿越漏洞(`file.filename` 未消毒)、綁 `0.0.0.0`、CORS 全開、無認證 | 中 | ⏸️ 暫不處理 | 該服務目前停滯、無人部署使用。**若未來要重新啟用,必須先修**:檔名改 `os.path.basename()` 或亂數、綁 `127.0.0.1` 或加 token 認證 |
| 4 | `file_cmd.rs` 的讀寫檔指令接受任意路徑(違反最小權限,但目前前端無 XSS 破口,風險受控) | 中低 | ⏸️ 暫不處理 | 維持現狀。**注意:未來若有任何頁面以 HTML 方式渲染伺服器/AI 回傳內容,需回頭限制路徑範圍** |
| 5 | 逐字稿功能走明文 HTTP 傳音檔 | 低 | ⏸️ 暫不處理 | 同 #3,服務停滯。重啟時若跨機使用建議上 HTTPS |
| 6 | 音檔上傳 Google Gemini 未告知使用者 | 低 | ✅ 已修(2026-07-09) | ReportPage 加入中英文警語 |

### 給接手者的資安維護建議

- 升級 sidecar 或依賴後,跑一次 `npm audit` 檢查。
- 不要在 repo 內放任何金鑰;新增外部服務時金鑰一律走 GitHub Secrets 或使用者輸入。
- 動到 `capabilities/default.json` 或 CSP 前,先理解 Tauri 的權限模型(前端視為不可信)。

---

## 7. 已知議題 / 待辦

- `ASR_NER_SERVER/` 停滯中,保留原樣;重啟前必修 §6 #3。
- `src-tauri/src/lib.rs` 的 `run()` 與 `greet` 未被使用(實際進入點是 `main.rs`),可擇機清理。
- `main.rs` 未註冊 `tauri-plugin-process`,但 `App.tsx` 更新流程有用到 `relaunch()`;若發現「更新完成後沒有自動重啟」即與此有關。
- README 的版本 badge(1.1.9)久未更新,與實際版本脫節。
