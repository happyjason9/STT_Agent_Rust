// src-tauri/src/commands/report_cmd.rs
use crate::services::report::ReportAgent;
use std::path::Path;
use tauri::command;
use serde::Deserialize;

#[derive(Debug, Deserialize)]
struct GeminiModelsResponse {
    models: Option<Vec<GeminiModelInfo>>,
}

#[derive(Debug, Deserialize)]
struct GeminiModelInfo {
    name: String,
    #[serde(rename = "supportedGenerationMethods")]
    supported_generation_methods: Option<Vec<String>>,
}

/// 列出 Gemini 可用模型（支援 generateContent）
#[command]
pub async fn list_gemini_models(api_key: String) -> Result<Vec<String>, String> {
    if api_key.is_empty() {
        return Err("請輸入 Gemini API Key".to_string());
    }

    let client = reqwest::Client::new();
    let url = "https://generativelanguage.googleapis.com/v1beta/models";

    let resp = client
        .get(url)
        .header("x-goog-api-key", &api_key)
        .send()
        .await
        .map_err(|e| format!("無法連線到 Gemini API: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("Gemini API 回傳錯誤 {}: {}", status, body));
    }

    let data: GeminiModelsResponse = resp
        .json()
        .await
        .map_err(|e| format!("解析模型清單失敗: {}", e))?;

    let excluded_keywords = ["embedding", "aqa", "imagen", "tts", "veo", "learnlm"];

    let models = data.models.unwrap_or_default();
    let mut result: Vec<String> = models
        .into_iter()
        .filter(|m| {
            // 必須支援 generateContent
            let supports_generate = m.supported_generation_methods
                .as_ref()
                .map(|methods| methods.iter().any(|method| method == "generateContent"))
                .unwrap_or(false);
            if !supports_generate {
                return false;
            }
            // 只保留 gemini- 開頭，排除非多模態模型
            let model_id = m.name.strip_prefix("models/").unwrap_or(&m.name).to_lowercase();
            model_id.starts_with("gemini-") && !excluded_keywords.iter().any(|kw| model_id.contains(kw))
        })
        .map(|m| {
            m.name.strip_prefix("models/").unwrap_or(&m.name).to_string()
        })
        .collect();

    result.sort();
    Ok(result)
}

/// 生成報告
/// 處理指定資料夾中的音檔，生成逐字稿報告，並自動轉換為 DOCX
#[command]
pub async fn generate_report(
    api_key: String,
    folder_path: String,
    model_name: Option<String>,
    custom_prompt_path: Option<String>,
) -> Result<String, String> {
    if api_key.is_empty() {
        return Err("請輸入 Gemini API Key".to_string());
    }
    if folder_path.is_empty() {
        return Err("請選擇音檔資料夾".to_string());
    }

    // 處理自定義 Prompt
    let custom_prompt = if let Some(path) = custom_prompt_path {
        if !path.is_empty() {
            match std::fs::read_to_string(&path) {
                Ok(content) => Some(content),
                Err(e) => return Err(format!("讀取自定義 Prompt 檔案失敗: {}", e)),
            }
        } else {
            None
        }
    } else {
        None
    };

    // 根據資料夾路徑推算輸出路徑 (04_report/report.md)
    let output_path = {
        let folder = Path::new(&folder_path);
        if folder.ends_with("02_split") {
            folder
                .parent()
                .map(|p| p.join("04_report").join("report.md").to_string_lossy().to_string())
                .unwrap_or_else(|| format!("{}/report.md", folder_path))
        } else {
            format!("{}/report.md", folder_path)
        }
    };

    // 1. 生成報告 (Markdown)
    let agent = ReportAgent::new(api_key);
    let report_result = agent
        .process_folder(&folder_path, &output_path, model_name, custom_prompt)
        .await?;

    // 2. 自動轉換為 DOCX
    let docx_result = match convert_md_to_docx_internal(&output_path).await {
        Ok(docx_path) => format!("\n\n✅ 已自動轉換為 Word 文件: {}", docx_path),
        Err(e) => format!("\n\n⚠️ Word 轉換失敗 (請確認已安裝 Pandoc): {}", e),
    };

    Ok(format!("{}{}", report_result, docx_result))
}

/// 將 Markdown 轉換為 DOCX (Command)
#[command]
pub async fn convert_md_to_docx(md_path: String) -> Result<String, String> {
    let docx_path = convert_md_to_docx_internal(&md_path).await?;
    Ok(format!("轉換成功！\nDOCX 檔案位置: {}", docx_path))
}

/// 內部函數：執行 Pandoc 轉換
async fn convert_md_to_docx_internal(md_path: &str) -> Result<String, String> {
    // 驗證檔案存在
    let md_file = Path::new(md_path);
    if !md_file.exists() {
        return Err(format!("找不到檔案: {}", md_path));
    }

    // 產生 DOCX 輸出路徑
    let docx_path = md_path.replace(".md", ".docx");

    // 使用 Pandoc 轉換
    let output = tokio::process::Command::new("pandoc")
        .args([md_path, "-o", &docx_path, "--from=markdown", "--to=docx"])
        .output()
        .await
        .map_err(|e| format!("無法執行 Pandoc: {}。請確認已安裝 Pandoc。", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Pandoc 轉換失敗: {}", stderr));
    }

    Ok(docx_path)
}

/// 取得預設 Prompt
#[command]
pub fn get_default_prompt() -> String {
    crate::services::report::DEFAULT_PROMPT.to_string()
}

/// 讀取自定義 Prompt 檔案內容
#[command]
pub fn read_custom_prompt(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| format!("無法讀取 Prompt 檔案: {}", e))
}

/// 舊的命令 (保留向後相容)
#[command]
#[deprecated(note = "使用 generate_report 替代")]
#[allow(deprecated)]
pub async fn run_report_cmd(_api_key: String) -> Result<String, String> {
    Err("請使用新的 generate_report 命令".to_string())
}
