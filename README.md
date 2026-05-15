# STT Agent (醫療音訊助理)

專為醫療專業人員設計的強大、安全且跨平台的桌面應用程式，用於高效處理、編輯和分析錄音檔案。基於 **Rust** 的穩健性與 **React** 的靈活性構建。

![Version](https://img.shields.io/badge/version-1.1.9-blue.svg)
![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20Linux-lightgrey.svg)
![Tauri](https://img.shields.io/badge/built%20with-Tauri_v2-orange.svg)

---

## 🚀 核心功能 (Features)

1.  **全能轉檔 (Format Converter)**
    *   支援將多種影音格式 (m4a, mp4, wav 等) 轉換為標準 **MP3** (44.1kHz, Mono/Stereo)。
    *   **自動化專案結構**：自動建立並管理 `01_converted`, `02_split`, `03_silence` 等標準工作流資料夾。
    *   核心採用業界標準 **FFmpeg** 技術，確保轉換穩定性。

2.  **精準切割 (Smart Splitter)**
    *   根據精確的時間戳記，將長錄音分割為多個片段。
    *   能夠快速將單次錄音中的多個不同病患案例分離出來。

3.  **智慧消音 (Time-Based Silence)**
    *   **批次逐字稿 (Batch Transcription)**：自動轉錄整個資料夾的錄音檔，並儲存為隱藏的 JSON 結構 (`.silence_reg`)，不干擾原始檔案。
    *   **視覺化消音 (Visual Muting)**：在逐字稿介面上直接勾選敏感段落，精準移除病患姓名或隱私資訊。
    *   **右鍵段落標記**：在逐字稿介面對段落按右鍵可快速標記，操作更直覺。(v1.1.7)
    *   **進度條時間提示**：滑鼠移至進度條時即時顯示對應時間點。(v1.1.7)
    *   **無損處理**：僅對指定區段進行靜音，保留原始音質與時間軸。

4.  **智慧報告 (AI Reporting)**
    *   **深度整合 LLM**：支援整合 **Google Gemini** 或 **Local LLM** 模型，理解上下文並生成專業報告。
    *   **必填 API Key**：使用報告生成功能前，需在頁面填入 Google Gemini API Key。
    *   **根據 API Key 等級自動列出可用模型**：系統會依照您的 API Key 權限，即時偵測並列出可選擇的 Gemini 模型（例如 Flash、Pro 等）。(v1.1.9)
    *   **醫學術語中英對照**：報告中的醫學英文術語自動附上中文翻譯，提升可讀性。(v1.1.9)
    *   **自動化歸檔**：生成的報告會自動儲存至 `04_report` 資料夾，方便日後查閱與匯出。
    *   **高解析度紀錄**：生成「逐字稿等級」的詳細醫療紀錄，涵蓋病患主訴、病史摘要與處置建議。

---

## 📦 使用者指南：安裝教學 (Installation)

### Windows 使用者
1.  前往本專案的 **[Releases 頁面](https://github.com/jasoncdc/STT_Agent_Rust/releases/latest)**。
2.  下載 `STT_Agent_x.x.x_x64-setup.exe`。
3.  執行安裝程式並依照指示完成安裝。
4.  本程式已內建 FFmpeg，**無需安裝任何額外軟體**即可使用。

<!-- ### Linux 使用者 (Ubuntu/Debian)
1.  前往本專案的 **[Releases 頁面](https://github.com/jasoncdc/STT_Agent_Rust/releases/latest)**。
2.  下載 `STT_Agent_x.x.x_amd64.deb`。
3.  開啟終端機 (Terminal) 並使用 `apt` 安裝 (系統會自動處理相依性)：
    ```bash
    # 執行安裝 (請將檔名替換為實際下載的版本)
    sudo apt install ./STT_Agent_1.1.9_amd64.deb
    ```
4.  安裝完成後，在應用程式選單搜尋 **"STT Agent"**，或在終端機輸入 `stt-agent` 即可啟動。 -->

---

## 🛠 開發者指南：環境建置 (Getting Started)

如果您希望從原始碼自行編譯，請參考以下步驟。

### 1. 必備環境 (Prerequisites)
*   **Node.js**: v20 或以上版本。
*   **Rust**: 請安裝最新穩定版 (`rustup update`)。
*   **FFmpeg**: 本地開發時，您的電腦必須已安裝 FFmpeg 並設定好環境變數 (PATH)。

#### Linux 環境需求 (Ubuntu)
您需要安裝 Tauri 和 WebKit 的系統依賴套件：
```bash
sudo apt update
sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file libssl-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev libasound2-dev
```

### 2. 專案初始化
Clone 專案後，安裝相關依賴：

```bash
# 1. 安裝前端套件
npm install

# 2. 檢查 Rust 環境與依賴
cd src-tauri
cargo check
cd ..
```

### 3. 啟動開發模式 (Development Mode)
使用支援熱重載 (Hot-reloading) 的開發模式：

```bash
npm run tauri dev
```
*   **前端**: 運行於 `localhost:1420`。
*   **後端**: 即時編譯 Rust 程式碼。
*   **Sidecar**: 在開發模式下，會自動使用您系統內建的 `ffmpeg`。

---

## 🏗 打包與發布流程 (Build & Release)

本專案採用「分離式建置策略」以確保最大的跨平台相容性。

### 1. Windows 打包
使用 `build_windows.yml` 腳本。它會自動綑綁專用的 Windows FFmpeg 執行檔。
*   **指令**: 標準 Tauri build (或透過 GitHub Actions)。
*   **產出**: `.exe` 安裝檔與 `.msi` 檔。

### 2. Linux 打包
使用 `build_linux.yml` 腳本 (Debian 專用)。它採用 **動態重新命名策略** 來避免與系統套件衝突。
*   **機制**: 在 CI 建置過程中，自動將程式碼中的 `ffmpeg` 參照改名為 `stt-ffmpeg`。
*   **產出**: `.deb` 安裝包 (符合 Debian 嚴格限制規範)。

---

## 📂 專案架構 (Project Structure)

本專案採用 **模組化服務導向架構 (Modular Service-Oriented Architecture)**：

*   **`src/`** (Frontend): React + TypeScript 使用者介面。
*   **`src-tauri/src/commands/`** (Controller): 定義可供前端呼叫的 Tauri 指令層。
*   **`src-tauri/src/services/`** (Business Logic): 核心功能模組化實作區：
    *   `converter.rs`: 負責轉檔與正規化。
    *   `splitter.rs`: 負責長錄音切割。
    *   `silence.rs`: 負責靜音處理與 FFmpeg 濾波器生成。
    *   `file_manager.rs`: 負責檔案讀寫與路徑管理。
*   **`src-tauri/src/models/`** (Data): 共用的資料結構定義。

### 資料夾工作流 (Workflow Directories)
程式會自動在您的專案路徑下建立以下結構：
*   **`01_converted/`**: 存放已轉為標準 MP3 的原始檔。
*   **`02_split/`**: 存放切割後的短片段。
*   **`03_silence/`**: 存放經過去識別化 (消音) 處理後的最終檔案。
*   **`04_report/`**: 存放由 AI 生成的醫療紀錄報告 (Markdown/PDF)。
*   **`.silence_reg/`** (Hidden): 存放批次逐字稿的 JSON 資料。

---

## 📝 授權 (License)

本專案為專有軟體 (Proprietary)，保留所有權利。
