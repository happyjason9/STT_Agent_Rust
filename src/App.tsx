import { useState, useRef, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import "./App.css";

// Import modular pages
import { ConvertPage } from "./pages/ConvertPage";
import { SplitPage } from "./pages/SplitPage";
import { SilencePage } from "./pages/SilencePage";
import { SilenceAutoPage } from "./pages/SilenceAutoPage";
import { WelcomePage } from "./pages/WelcomePage";
import { ReportPage } from "./pages/ReportPage";
import { useI18n } from "./i18n";

type Tab = "welcome" | "convert" | "split" | "silence" | "silence-auto" | "report";
type MenuOpen = "file" | "edit" | null;
type Theme = "dark" | "light";

// SVG Icons
const ConvertIcon = () => (
  <svg
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="17 8 12 3 7 8" />
    <line x1="12" y1="3" x2="12" y2="15" />
  </svg>
);

const SplitIcon = () => (
  <svg
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <line x1="12" y1="2" x2="12" y2="22" />
    <path d="M17 5H9a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h8" />
    <path d="M7 12h10" />
  </svg>
);

const SilenceIcon = () => (
  <svg
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
    <line x1="23" y1="9" x2="17" y2="15" />
    <line x1="17" y1="9" x2="23" y2="15" />
  </svg>
);

const ReportIcon = () => (
  <svg
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <line x1="16" y1="13" x2="8" y2="13" />
    <line x1="16" y1="17" x2="8" y2="17" />
    <polyline points="10 9 9 9 8 9" />
  </svg>
);

function App() {
  const { language, setLanguage, t } = useI18n();

  const [activeTab, setActiveTab] = useState<Tab>(() => {
    // Check for query param ?page=welcome
    const params = new URLSearchParams(window.location.search);
    if (params.get("page") === "welcome") {
      return "welcome";
    }

    // Check localStorage for saved tab
    const lastTab = localStorage.getItem("app-last-tab");

    // User requested: If last closed on Welcome Page -> reopen Welcome Page
    if (lastTab === "welcome") {
      return "welcome";
    }

    // User requested: If last closed in project -> reopen Convert Page (default)
    // We assume any other tab implies "in project"
    // Also check if we have a last project to load
    const lastProject = localStorage.getItem("app-last-project");
    if (lastProject) {
      return "convert";
    }

    // Fallback
    return "welcome";
  });

  // Load last project on startup if we are in project mode
  useEffect(() => {
    const lastProject = localStorage.getItem("app-last-project");
    if (activeTab !== "welcome" && lastProject) {
      invoke("open_project_cmd", { path: lastProject }).catch(console.error);
    }
  }, []); // Run once on mount

  // Save activeTab to localStorage whenever it changes
  useEffect(() => {
    localStorage.setItem("app-last-tab", activeTab);
  }, [activeTab]);

  const [openMenu, setOpenMenu] = useState<MenuOpen>(null);
  const [showAbout, setShowAbout] = useState(false);
  const [pendingUpdate, setPendingUpdate] = useState<{ version: string; body: string; update: any } | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);

  const [fontSize, setFontSize] = useState(() => {
    const saved = localStorage.getItem("app-font-size");
    const initial = saved ? parseInt(saved, 10) : 16;
    return isNaN(initial) ? 16 : initial;
  });

  const [theme, setTheme] = useState<Theme>(() => {
    const saved = localStorage.getItem("app-theme");
    return saved === "light" ? "light" : "dark";
  });

  const menuRef = useRef<HTMLDivElement>(null);

  const menuItems: {
    id: Tab;
    labelKey: keyof typeof t;
    icon: React.ReactNode;
  }[] = [
      { id: "convert", labelKey: "convert", icon: <ConvertIcon /> },
      { id: "split", labelKey: "split", icon: <SplitIcon /> },
      { id: "silence", labelKey: "silence", icon: <SilenceIcon /> },
      { id: "silence-auto", labelKey: "silenceAuto", icon: <SilenceIcon /> },
      { id: "report", labelKey: "report", icon: <ReportIcon /> },
    ];

  // Helper to save recent project
  const saveRecentProject = (path: string) => {
    try {
      const name = path.split(/[/\\]/).pop() || path;
      const newProject = { path, name, lastOpened: Date.now() };
      const saved = localStorage.getItem("recent-projects");
      let current: any[] = saved ? JSON.parse(saved) : [];

      current = current.filter((p: any) => p.path !== path);
      current.unshift(newProject);
      current = current.slice(0, 10);

      localStorage.setItem("recent-projects", JSON.stringify(current));
    } catch (e) {
      console.error("Failed to save recent project", e);
    }
  };

  // 點擊外部關閉選單
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setOpenMenu(null);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // 更新字體大小並儲存
  useEffect(() => {
    document.documentElement.style.fontSize = `${fontSize}px`;
    localStorage.setItem("app-font-size", fontSize.toString());
  }, [fontSize]);

  // 更新主題並儲存
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("app-theme", theme);
  }, [theme]);

  // Auto-Update Check (VS Code style: one-time notification per version)
  useEffect(() => {
    const checkUpdate = async () => {
      try {
        const update = await check();
        if (update?.available) {
          setPendingUpdate({ version: update.version, body: update.body || "", update });

          // Only show notification once per version
          const dismissedVersion = localStorage.getItem("dismissed-update-version");
          if (dismissedVersion !== update.version) {
            localStorage.setItem("dismissed-update-version", update.version);
            // Show a brief notification via the output or alert
            const msg = language === "zh"
              ? `發現新版本 v${update.version}，可從「檔案 → 更新版本」進行更新。`
              : `v${update.version} is available. Update from File → Update Available.`;
            alert(msg);
          }
        }
      } catch (error) {
        console.error("Failed to check for updates:", error);
      }
    };
    checkUpdate();
  }, []);

  const handleExit = async () => {
    await invoke("exit_app");
  };

  const handleUninstall = async () => {
    try {
      await invoke("uninstall_app");
    } catch (error) {
      console.error("Uninstall failed:", error);
      if (error === "PLATFORM_NOT_SUPPORTED") {
        alert(
          language === "zh"
            ? "Linux 系統請透過套件管理員移除：\n\n終端機執行：\nsudo apt remove stt-agent"
            : "On Linux, please uninstall via terminal:\n\nsudo apt remove stt-agent",
        );
      } else {
        alert(
          language === "zh"
            ? "無法啟動解除安裝程式 (可能因為是在開發模式下運行，或者找不到 uninstall.exe)"
            : "Cannot start uninstaller (possibly running in dev mode or uninstall.exe not found)",
        );
      }
    }
  };

  const handleZoomIn = () => {
    setFontSize((prev) => Math.min(prev + 2, 24));
  };

  const handleZoomOut = () => {
    setFontSize((prev) => Math.max(prev - 2, 12));
  };

  const handleResetZoom = () => {
    setFontSize(16);
  };

  const handleSetThemeDark = () => {
    setTheme("dark");
    setOpenMenu(null);
  };

  const handleSetThemeLight = () => {
    setTheme("light");
    setOpenMenu(null);
  };

  const handleSetLanguageChinese = () => {
    setLanguage("zh");
    setOpenMenu(null);
  };

  const handleSetLanguageEnglish = () => {
    setLanguage("en");
    setOpenMenu(null);
  };

  const handleShowAbout = () => {
    setShowAbout(true);
    setOpenMenu(null);
  };



  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(() => {
    return localStorage.getItem("sidebar-collapsed") === "true";
  });

  useEffect(() => {
    localStorage.setItem("sidebar-collapsed", isSidebarCollapsed.toString());
  }, [isSidebarCollapsed]);

  return (
    <div className="app-wrapper">
      {/* ... (About Dialog and Menu Bar remain unchanged, omitting for brevity in tool call if possible, but safer to keep structure?) 
          Actually I need to replace the RETURN statement area mostly.
      */}
      {/* About Dialog */}
      {showAbout && (
        <div className="modal-overlay" onClick={() => setShowAbout(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h2>{t.aboutTitle}</h2>
            <div className="about-info">
              <p>
                <strong>{t.version}:</strong> 1.8.0
              </p>
              <p>{t.description}</p>
            </div>
            <button
              className="btn btn-primary"
              onClick={() => setShowAbout(false)}
            >
              {t.close}
            </button>
          </div>
        </div>
      )}

      {/* Top Menu Bar */}
      <div className="menu-bar" ref={menuRef}>
        <div className="menu-item-wrapper">
          <button
            className={`menu-button ${openMenu === "file" ? "active" : ""}`}
            onClick={() => setOpenMenu(openMenu === "file" ? null : "file")}
          >
            {t.file}
          </button>
          {openMenu === "file" && (
            <div className="dropdown-menu">
              <button className="dropdown-item" onClick={async () => {
                try {
                  const selected = await open({ directory: true, multiple: false, title: language === "zh" ? "選擇新建專案位置" : "Select location for new project" });
                  if (selected && typeof selected === "string") {
                    await invoke("create_project_cmd", { path: selected });
                    saveRecentProject(selected);
                    alert(language === "zh" ? `專案建立成功: ${selected}` : `Project created: ${selected}`);
                    setOpenMenu(null);
                  }
                } catch (e) { console.error(e); alert(e); }
              }}>
                {t.newProject}
              </button>
              <button className="dropdown-item" onClick={async () => {
                try {
                  const selected = await open({ directory: true, multiple: false, title: language === "zh" ? "選擇專案資料夾" : "Select project folder" });
                  if (selected && typeof selected === "string") {
                    await invoke("open_project_cmd", { path: selected });
                    saveRecentProject(selected);
                    alert(language === "zh" ? `專案開啟成功: ${selected}` : `Project opened: ${selected}`);
                    setOpenMenu(null);
                  }
                } catch (e) { console.error(e); alert(e); }
              }}>
                {t.openProject}
              </button>
              <button className="dropdown-item" onClick={async () => {
                try {
                  await invoke("new_window_cmd");
                  setOpenMenu(null);
                } catch (e) { console.error(e); alert(e); }
              }}>
                {t.newWindow}
              </button>
              <div className="dropdown-divider"></div>
              <button className="dropdown-item" onClick={handleShowAbout}>
                {t.about}
              </button>
              {pendingUpdate && (
                <button
                  className="dropdown-item"
                  style={{ color: "var(--accent-primary)", fontWeight: "bold" }}
                  onClick={async () => {
                    setOpenMenu(null);
                    setIsUpdating(true);
                    try {
                      await pendingUpdate.update.downloadAndInstall();
                      await relaunch();
                    } catch (err) {
                      console.error("Update failed:", err);
                      setIsUpdating(false);
                      alert(language === "zh" ? `更新失敗: ${err}` : `Update failed: ${err}`);
                    }
                  }}
                  disabled={isUpdating}
                >
                  {isUpdating ? t.updating : `${t.updateVersion} (v${pendingUpdate.version})`}
                </button>
              )}
              <div className="dropdown-divider"></div>
              <button className="dropdown-item" onClick={handleUninstall}>
                {t.uninstall}
              </button>
              <button className="dropdown-item" onClick={handleExit}>
                {t.exit}
              </button>
            </div>
          )}
        </div>
        <div className="menu-item-wrapper">
          <button
            className={`menu-button ${openMenu === "edit" ? "active" : ""}`}
            onClick={() => setOpenMenu(openMenu === "edit" ? null : "edit")}
          >
            {t.edit}
          </button>
          {openMenu === "edit" && (
            <div className="dropdown-menu">
              <div className="dropdown-submenu-wrapper">
                <button className="dropdown-item has-submenu">
                  {t.font}
                  <span className="submenu-arrow">›</span>
                </button>
                <div className="dropdown-submenu">
                  <button className="dropdown-item" onClick={handleZoomIn}>
                    {t.zoomIn}
                  </button>
                  <button className="dropdown-item" onClick={handleZoomOut}>
                    {t.zoomOut}
                  </button>
                  <button className="dropdown-item" onClick={handleResetZoom}>
                    {t.resetZoom}
                  </button>
                </div>
              </div>
              <div className="dropdown-submenu-wrapper">
                <button className="dropdown-item has-submenu">
                  {t.appearance}
                  <span className="submenu-arrow">›</span>
                </button>
                <div className="dropdown-submenu">
                  <button
                    className={`dropdown-item ${theme === "dark" ? "selected" : ""}`}
                    onClick={handleSetThemeDark}
                  >
                    {t.darkMode}
                  </button>
                  <button
                    className={`dropdown-item ${theme === "light" ? "selected" : ""}`}
                    onClick={handleSetThemeLight}
                  >
                    {t.lightMode}
                  </button>
                </div>
              </div>
              <div className="dropdown-submenu-wrapper">
                <button className="dropdown-item has-submenu">
                  {t.language}
                  <span className="submenu-arrow">›</span>
                </button>
                <div className="dropdown-submenu">
                  <button
                    className={`dropdown-item ${language === "zh" ? "selected" : ""}`}
                    onClick={handleSetLanguageChinese}
                  >
                    {t.chinese}
                  </button>
                  <button
                    className={`dropdown-item ${language === "en" ? "selected" : ""}`}
                    onClick={handleSetLanguageEnglish}
                  >
                    {t.english}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="app-layout">
        {/* Sidebar - Hide if welcome page */}
        {activeTab !== "welcome" && (
          <aside className={`sidebar ${isSidebarCollapsed ? "collapsed" : ""}`}>
            {/* Header */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                minHeight: isSidebarCollapsed ? "10px" : "50px",
                paddingLeft: isSidebarCollapsed ? "0" : "24px",
                transition: "all 0.3s ease",
                overflow: "hidden",
              }}
            >
              {/* Show Title only when Expanded */}
              {!isSidebarCollapsed && (
                <h2 className="sidebar-title" style={{ padding: 0 }}>
                  {t.appTitle}
                </h2>
              )}
            </div>

            <nav className="sidebar-nav">
              {menuItems.map((item) => (
                <button
                  key={item.id}
                  onClick={() => setActiveTab(item.id)}
                  className={`sidebar-item ${activeTab === item.id ? "active" : ""}`}
                  title={isSidebarCollapsed ? (t[item.labelKey] as string) : ""}
                >
                  <span className="sidebar-icon">{item.icon}</span>
                  {!isSidebarCollapsed && (
                    <span className="sidebar-label">
                      {t[item.labelKey] as string}
                    </span>
                  )}
                </button>
              ))}
            </nav>

            {/* Vertical Toggle Strip */}
            <div
              className="sidebar-toggle-strip"
              onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
              title={isSidebarCollapsed ? "Expand" : "Collapse"}
            >
              <span className="sidebar-toggle-arrow">
                {isSidebarCollapsed ? "▶" : "◀"}
              </span>
            </div>
          </aside>
        )}

        {/* Main Content */}
        <main className="main-content">
          {/* Content Area - All components stay mounted, hidden with CSS for state persistence */}
          <div className="content-area">
            {activeTab === "welcome" && (
              <WelcomePage onProjectOpened={() => setActiveTab("convert")} />
            )}
            <div
              style={{ display: activeTab === "convert" ? "block" : "none" }}
            >
              <ConvertPage />
            </div>
            <div style={{ display: activeTab === "split" ? "block" : "none" }}>
              <SplitPage />
            </div>
            <div
              style={{ display: activeTab === "silence" ? "block" : "none" }}
            >
              <SilencePage />
            </div>
            <div
              style={{ display: activeTab === "silence-auto" ? "block" : "none" }}
            >
              <SilenceAutoPage />
            </div>
            <div style={{ display: activeTab === "report" ? "block" : "none" }}>
              <ReportPage isActive={activeTab === "report"} />
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

export default App;
