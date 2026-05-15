import React, { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open, message } from "@tauri-apps/plugin-dialog";
import { useI18n } from "../i18n";

interface ReportPageProps {
    isActive?: boolean;
}

export function ReportPage({ isActive }: ReportPageProps) {
    const { t, language } = useI18n();
    const [apiKey, setApiKey] = useState("");
    const [showApiKey, setShowApiKey] = useState(false);
    const [folderPath, setFolderPath] = useState("");
    const [output, setOutput] = useState("");
    const [loading, setLoading] = useState(false);
    // const [converting, setConverting] = useState(false);
    // const [reportPath, setReportPath] = useState("");
    const [modelName, setModelName] = useState("gemini-2.5-pro");
    const [availableModels, setAvailableModels] = useState<string[]>([]);
    const [modelsLoading, setModelsLoading] = useState(false);
    const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [customPromptPath, setCustomPromptPath] = useState("");
    const [showPromptModal, setShowPromptModal] = useState(false);
    const [defaultPrompt, setDefaultPrompt] = useState("");
    const [modalTitle, setModalTitle] = useState("");

    interface ModelPricing {
        model_id: string;
        input_free: string;
        input_paid: string;
        output_free: string;
        output_paid: string;
        sort_price: number;
    }
    const [pricingMap, setPricingMap] = useState<Record<string, ModelPricing>>({});
    const [showPriceModal, setShowPriceModal] = useState(false);

    // 啟動時抓取定價（每天一次，由後端快取）
    useEffect(() => {
        invoke<ModelPricing[]>("fetch_gemini_pricing")
            .then((list) => {
                const map: Record<string, ModelPricing> = {};
                list.forEach((p) => { map[p.model_id] = p; });
                setPricingMap(map);
            })
            .catch(() => {}); // 失敗靜默，不影響主功能
    }, []);

    // 依定價排序模型列表（sort_price 低到高），無定價資料排最後
    function sortModelsByPrice(models: string[]): string[] {
        return [...models].sort((a, b) => {
            const pa = pricingMap[a]?.sort_price ?? 9999;
            const pb = pricingMap[b]?.sort_price ?? 9999;
            if (pa !== pb) return pa - pb;
            return a.localeCompare(b);
        });
    }

    // 取得 Gemini 可用模型列表
    async function fetchAvailableModels(key: string) {
        if (!key) return;
        setModelsLoading(true);
        try {
            const models = await invoke<string[]>("list_gemini_models", { apiKey: key });
            const sorted = sortModelsByPrice(models);
            setAvailableModels(sorted);
            if (sorted.length > 0 && !sorted.includes(modelName)) {
                setModelName(sorted[0]);
            }
        } catch {
            setAvailableModels([]);
        } finally {
            setModelsLoading(false);
        }
    }

    // 選擇資料夾
    async function handleSelectFolder() {
        try {
            const selected = await open({
                directory: true,
                multiple: false,
                title: language === "zh" ? "選擇音檔資料夾" : "Select Audio Folder",
                defaultPath: "02_split"
            });

            if (selected && typeof selected === "string") {
                setFolderPath(selected);
                localStorage.setItem("latest_report_folder", selected);
            }
        } catch (err) {
            setOutput(`${t.selectFileError}: ${err}`);
        }
    }

    // 選擇 Prompt 檔案
    async function handleSelectPromptFile() {
        try {
            const selected = await open({
                multiple: false,
                title: language === "zh" ? "選擇自定義 Prompt (.txt)" : "Select Custom Prompt (.txt)",
                filters: [{ name: "Text", extensions: ["txt"] }],
            });

            if (selected && typeof selected === "string") {
                setCustomPromptPath(selected);
            }
        } catch (err) {
            setOutput(`${t.selectFileError}: ${err}`);
        }
    }

    async function handleViewPrompt() {
        try {
            const rawPrompt = await invoke<string>("get_default_prompt");
            const title = t.defaultPromptTitle;

            // Format the prompt to remove leading indentation
            const lines = rawPrompt.split('\n');
            // Find minimum indentation (ignoring empty lines)
            const minIndent = lines
                .filter(line => line.trim().length > 0)
                .reduce((min, line) => {
                    const indent = line.search(/\S/);
                    return indent !== -1 ? Math.min(min, indent) : min;
                }, Infinity);

            const cleanedPrompt = lines
                .map(line => {
                    if (minIndent !== Infinity && line.length >= minIndent) {
                        return line.slice(minIndent);
                    }
                    return line.trim(); // Trim empty or whitespace-only lines
                })
                .join('\n')
                .trim();

            setDefaultPrompt(cleanedPrompt);
            setModalTitle(title);
            setShowPromptModal(true);
        } catch (err) {
            console.error("Failed to get default prompt:", err);
            setOutput(`${t.error}: ${err}`);
        }
    }

    // 生成報告
    async function runReport() {
        if (!apiKey) {
            setOutput(`${t.error}: ${t.errorApiKey}`);
            return;
        }
        if (!folderPath) {
            setOutput(`${t.error}: ${t.errorSelectFolder}`);
            return;
        }

        setLoading(true);
        setOutput(t.processingReport);

        // 訂閱即時進度 event，每條訊息附加到輸出區
        const unlisten = await listen<string>("report-progress", (ev) => {
            setOutput((prev) => prev + "\n" + ev.payload);
        });

        try {
            const result = await invoke("generate_report", {
                apiKey,
                folderPath,
                modelName,
                customPromptPath: customPromptPath || null,
            });
            setOutput((prev) => prev + "\n\n" + (result as string));
        } catch (err) {
            const errorMsg = String(err);
            setOutput((prev) => prev + "\n\n❌ " + errorMsg);
            await message(errorMsg, {
                title: language === "zh" ? "API 處理發生錯誤" : "API Processing Error",
                kind: "error"
            });
        } finally {
            unlisten();
            setLoading(false);
        }
    }

    // 選擇 MD 檔案 - 暫時隱藏
    /*
    async function handleSelectMdFile() {
        try {
            const selected = await open({
                multiple: false,
                title: language === "zh" ? "選擇 Markdown 報告檔案" : "Select Markdown Report File",
                filters: [{ name: "Markdown", extensions: ["md"] }],
            });
    
            if (selected && typeof selected === "string") {
                setReportPath(selected);
            }
        } catch (err) {
            setOutput(`${t.selectFileError}: ${err}`);
        }
    }
    */

    // 轉換為 DOCX - 暫時隱藏
    /*
    async function convertToDocx() {
        if (!reportPath) {
            setOutput(`${t.error}: ${t.errorSelectReport}`);
            return;
        }
    
        setConverting(true);
        setOutput(t.convertingToDocx);
    
        try {
            const result = await invoke("convert_md_to_docx", {
                mdPath: reportPath,
            });
            setOutput(result as string);
        } catch (err) {
            setOutput(`${t.error}: ${err}`);
        } finally {
            setConverting(false);
        }
    }
    */

    // Load default path from localStorage
    useEffect(() => {
        if (isActive) {
            const stored = localStorage.getItem("latest_report_folder");
            if (stored) {
                setFolderPath(stored);
            }
        }
    }, [isActive]);

    useEffect(() => {
        const stored = localStorage.getItem("latest_report_folder");
        if (stored) {
            setFolderPath(stored);
        }
    }, []);

    return (
        <div>
            <h2 className="page-title">📄 {t.reportTitle}</h2>
            <p className="page-description">{t.reportDescription}</p>

            {/* 資料夾選擇 - UI Adjusted: Button top-left of input */}
            <div className="input-group" style={{ marginBottom: "20px" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px" }}>
                    <label className="input-label" style={{ marginBottom: 0 }}>{t.audioFolder}</label>
                    <button
                        className="btn btn-secondary"
                        onClick={handleSelectFolder}
                        style={{ padding: "4px 12px", fontSize: "0.9rem" }}
                    >
                        📁 {t.selectFolder}
                    </button>
                </div>

                <input
                    type="text"
                    className="input"
                    value={folderPath}
                    placeholder={t.selectFolderPlaceholder}
                    readOnly
                    style={{ width: "100%" }}
                />
            </div>

            {/* API Key 輸入 */}
            <div className="input-group" style={{ marginBottom: "20px" }}>
                <label className="input-label">{t.apiKeyLabel}</label>
                <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                    <input
                        type={showApiKey ? "text" : "password"}
                        className="input"
                        onChange={(e) => {
                            const val = e.target.value;
                            setApiKey(val);
                            if (debounceTimer.current) clearTimeout(debounceTimer.current);
                            debounceTimer.current = setTimeout(() => fetchAvailableModels(val), 1000);
                        }}
                        placeholder={t.apiKeyPlaceholder}
                        value={apiKey}
                        style={{ flex: 1, maxWidth: "400px" }}
                    />
                    <button
                        className="btn btn-secondary"
                        onClick={() => setShowApiKey(!showApiKey)}
                        style={{ minWidth: "80px" }}
                    >
                        {showApiKey ? `🙈 ${t.hide}` : `👁️ ${t.show}`}
                    </button>
                </div>
            </div>

            {/* 模型選擇 */}
            <div className="input-group" style={{ marginBottom: "20px" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px" }}>
                    <label className="input-label" style={{ marginBottom: 0 }}>{t.selectModel}</label>
                    <button
                        className="btn btn-secondary"
                        onClick={() => fetchAvailableModels(apiKey)}
                        disabled={!apiKey || modelsLoading}
                        style={{ padding: "4px 12px", fontSize: "0.9rem" }}
                    >
                        {modelsLoading ? <span className="loading-spinner"></span> : "🔄"} {language === "zh" ? "重新偵測" : "Refresh"}
                    </button>
                </div>
                <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                    <select
                        className="custom-file-select"
                        value={modelName}
                        onChange={(e) => setModelName(e.target.value)}
                        style={{ flex: 1 }}
                    >
                        {availableModels.length > 0 ? (
                            availableModels.map((m) => (
                                <option key={m} value={m}>{m}</option>
                            ))
                        ) : (
                            <>
                                <option value="gemini-2.5-pro">gemini-2.5-pro</option>
                                <option value="gemini-2.5-flash">gemini-2.5-flash</option>
                                <option value="gemini-2.0-flash">gemini-2.0-flash</option>
                            </>
                        )}
                    </select>
                    <button
                        className="btn btn-secondary"
                        onClick={() => setShowPriceModal(true)}
                        title={language === "zh" ? "查看定價" : "View pricing"}
                        style={{ padding: "4px 10px", fontSize: "0.9rem", whiteSpace: "nowrap" }}
                    >
                        💰
                    </button>
                </div>
                {availableModels.length > 0 && (
                    <div style={{ fontSize: "0.8rem", color: "var(--text-secondary)", marginTop: "4px" }}>
                        {language === "zh" ? `✅ 已偵測到 ${availableModels.length} 個可用模型` : `✅ ${availableModels.length} models detected`}
                    </div>
                )}
            </div>

            {/* 價格彈窗：顯示所有模型完整定價 */}
            {showPriceModal && (() => {
                const borderColor = "var(--border-color, #444)";
                const textSecondary = "var(--text-secondary, #888)";
                const modelsToShow = availableModels.length > 0 ? availableModels : Object.keys(pricingMap);
                const thStyle: React.CSSProperties = {
                    padding: "6px 10px", fontWeight: 600, fontSize: "0.78rem",
                    borderBottom: `1px solid ${borderColor}`, whiteSpace: "pre-line",
                    background: "#0f0f1a",
                    color: "#e2e8f0",
                    position: "sticky", top: 0, zIndex: 1,
                };
                const tdStyle: React.CSSProperties = {
                    padding: "8px 10px", fontSize: "0.82rem", verticalAlign: "top",
                    borderBottom: `1px solid ${borderColor}`, whiteSpace: "pre-line",
                    background: "#2a2a3e",
                };
                return (
                    <div
                        style={{
                            position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)",
                            display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000,
                        }}
                        onClick={() => setShowPriceModal(false)}
                    >
                        <div
                            style={{
                                background: "var(--bg-secondary, #1e1e2e)",
                                border: `1px solid ${borderColor}`,
                                borderRadius: "12px", padding: "24px",
                                width: "min(860px, 95vw)", maxHeight: "80vh",
                                display: "flex", flexDirection: "column",
                            }}
                            onClick={(e) => e.stopPropagation()}
                        >
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
                                <h3 style={{ margin: 0, fontSize: "1rem" }}>
                                    💰 {language === "zh" ? "Gemini 模型定價（標準方案）" : "Gemini Model Pricing (Standard)"}
                                </h3>
                                <span style={{ fontSize: "0.75rem", color: textSecondary }}>
                                    {language === "zh" ? "每 100 萬 token（美元）· 每日更新" : "Per 1M tokens (USD) · Updated daily"}
                                </span>
                            </div>

                            <div style={{ overflowY: "auto", flex: 1 }}>
                                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                                    <thead>
                                        <tr>
                                            <th style={{ ...thStyle, textAlign: "left", width: "22%" }}>
                                                {language === "zh" ? "模型" : "Model"}
                                            </th>
                                            <th style={{ ...thStyle, textAlign: "center", width: "19%" }}>
                                                {language === "zh" ? "輸入（免費）" : "Input (Free)"}
                                            </th>
                                            <th style={{ ...thStyle, textAlign: "center", width: "30%" }}>
                                                {language === "zh" ? "輸入（付費層級）" : "Input (Paid)"}
                                            </th>
                                            <th style={{ ...thStyle, textAlign: "center", width: "14%" }}>
                                                {language === "zh" ? "輸出（免費）" : "Output (Free)"}
                                            </th>
                                            <th style={{ ...thStyle, textAlign: "center", width: "15%" }}>
                                                {language === "zh" ? "輸出（付費）" : "Output (Paid)"}
                                            </th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {modelsToShow.map((m) => {
                                            const p = pricingMap[m];
                                            const isSelected = m === modelName;
                                            return (
                                                <tr
                                                    key={m}
                                                    onClick={() => { setModelName(m); setShowPriceModal(false); }}
                                                    title={language === "zh" ? "點擊選擇此模型" : "Click to select"}
                                                    style={{ cursor: "pointer" }}
                                                >
                                                    {(() => {
                                                        const rowBg = isSelected ? "#3b3b6b" : "#2a2a3e";
                                                        const cellStyle = { ...tdStyle, background: rowBg };
                                                        return p ? (
                                                            <>
                                                                <td style={{ ...cellStyle, fontWeight: isSelected ? 700 : 400 }}>
                                                                    {isSelected && <span style={{ color: "#818cf8", marginRight: 4 }}>▶</span>}
                                                                    {m}
                                                                </td>
                                                                <td style={{ ...cellStyle, textAlign: "center", color: textSecondary }}>{p.input_free}</td>
                                                                <td style={{ ...cellStyle, textAlign: "center" }}>{p.input_paid}</td>
                                                                <td style={{ ...cellStyle, textAlign: "center", color: textSecondary }}>{p.output_free}</td>
                                                                <td style={{ ...cellStyle, textAlign: "center" }}>{p.output_paid}</td>
                                                            </>
                                                        ) : (
                                                            <>
                                                                <td style={{ ...cellStyle, fontWeight: isSelected ? 700 : 400 }}>
                                                                    {isSelected && <span style={{ color: "#818cf8", marginRight: 4 }}>▶</span>}
                                                                    {m}
                                                                </td>
                                                                <td colSpan={4} style={{ ...cellStyle, color: textSecondary, textAlign: "center" }}>
                                                                    {language === "zh" ? "無定價資料" : "No pricing data"}
                                                                </td>
                                                            </>
                                                        );
                                                    })()}
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>

                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "14px" }}>
                                <span style={{ fontSize: "0.72rem", color: textSecondary }}>
                                    ai.google.dev/gemini-api/docs/pricing
                                </span>
                                <button
                                    className="btn btn-secondary"
                                    onClick={() => setShowPriceModal(false)}
                                    style={{ padding: "4px 20px" }}
                                >
                                    {language === "zh" ? "關閉" : "Close"}
                                </button>
                            </div>
                        </div>
                    </div>
                );
            })()}

            {/* 自定義 Prompt 輸入 */}
            <div className="input-group" style={{ marginBottom: "20px" }}>
                <label className="input-label">{t.customPrompt}</label>
                <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                    <input
                        type="text"
                        className="input"
                        value={customPromptPath}
                        placeholder={t.customPromptPlaceholder}
                        readOnly
                        style={{ flex: 1, maxWidth: "500px" }}
                    />
                    <button
                        className="btn btn-secondary"
                        onClick={handleSelectPromptFile}
                    >
                        📝 {t.selectPrompt}
                    </button>
                    <button
                        className="btn btn-secondary"
                        onClick={handleViewPrompt}
                        title={t.viewPrompt}
                    >
                        👁️ {t.viewPrompt}
                    </button>
                    {customPromptPath && (
                        <button
                            className="btn btn-secondary"
                            onClick={() => setCustomPromptPath("")}
                            style={{ backgroundColor: "#e74c3c" }}
                        >
                            🗑️ {t.clear}
                        </button>
                    )}
                </div>
            </div>

            {/* 生成按鈕 */}
            <div className="btn-group" style={{ marginBottom: "30px" }}>
                <button
                    className="btn btn-primary"
                    onClick={runReport}
                    disabled={loading}
                >
                    {loading && <span className="loading-spinner"></span>}
                    {loading ? t.generating : `🚀 ${t.generateReport}`}
                </button>
            </div>

            {/* 暫時隱藏手動工具功能
            <hr style={{ margin: "20px 0", borderColor: "#444" }} />

            <h3 style={{ marginBottom: "15px", fontSize: "1rem", color: "#888" }}>🛠️ {t.manualTools}</h3>

            <div className="input-group" style={{ marginBottom: "15px" }}>
                <label className="input-label">{t.selectReportFile}</label>
                <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                    <input
                        type="text"
                        className="input"
                        value={reportPath}
                        placeholder={t.selectReportPlaceholder}
                        readOnly
                        style={{ flex: 1, maxWidth: "500px" }}
                    />
                    <button
                        className="btn btn-secondary"
                        onClick={handleSelectMdFile}
                        disabled={converting}
                    >
                        📂 {t.selectFile}
                    </button>
                </div>
            </div>

            <div className="btn-group">
                <button
                    className="btn btn-primary"
                    onClick={convertToDocx}
                    disabled={loading || converting || !reportPath}
                >
                    {converting && <span className="loading-spinner"></span>}
                    {converting ? t.convertingDocx : `📝 ${t.convertToDocx}`}
                </button>
            </div>
            */}

            {/* 輸出區域 */}
            {output && (
                <div
                    className={`output-box ${output.includes(t.error) ? "error" : ""}`}
                    style={{ marginTop: "20px", whiteSpace: "pre-wrap" }}
                >
                    {output}
                </div>
            )}

            {/* Default Prompt Modal */}
            {showPromptModal && (
                <div className="modal-overlay" onClick={() => setShowPromptModal(false)}>
                    <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: "800px", width: "90%" }}>
                        <h3 style={{ marginBottom: "16px", color: "var(--text-primary)" }}>{modalTitle}</h3>
                        <div style={{
                            backgroundColor: "var(--bg-tertiary)",
                            padding: "16px",
                            borderRadius: "8px",
                            border: "1px solid var(--border)",
                            whiteSpace: "pre-wrap",
                            maxHeight: "60vh",
                            overflowY: "auto",
                            fontFamily: "monospace",
                            fontSize: "0.9rem",
                            lineHeight: "1.5",
                            color: "var(--text-secondary)"
                        }}>
                            {defaultPrompt}
                        </div>
                        <div style={{ marginTop: "20px", textAlign: "right" }}>
                            <button
                                className="btn btn-primary"
                                onClick={() => setShowPromptModal(false)}
                            >
                                {t.close}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
