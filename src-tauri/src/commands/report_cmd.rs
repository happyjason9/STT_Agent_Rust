// src-tauri/src/commands/report_cmd.rs
use crate::services::report::ReportAgent;
use std::path::Path;
use tauri::{command, Manager};
use serde::{Deserialize, Serialize};

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

    let excluded_keywords = ["embedding", "aqa", "imagen", "image", "tts", "veo", "learnlm", "robotics", "live", "native-audio", "computer-use"];

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
            let model_id = m.name.strip_prefix("models/").unwrap_or(&m.name).to_lowercase();
            if !model_id.starts_with("gemini-") {
                return false;
            }
            // 排除非文字生成模型
            if excluded_keywords.iter().any(|kw| model_id.contains(kw)) {
                return false;
            }
            // 排除版本號 alias（-001、-002 等）和 -latest alias
            if model_id.ends_with("-latest") {
                return false;
            }
            let last_part = model_id.split('-').last().unwrap_or("");
            if last_part.len() == 3 && last_part.chars().all(|c| c.is_ascii_digit()) {
                return false;
            }
            true
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
    app: tauri::AppHandle,
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
        .process_folder(&folder_path, &output_path, model_name, custom_prompt, &app)
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

// ---- 定價爬取 ----

#[derive(Debug, Serialize, Clone)]
pub struct ModelPricing {
    pub model_id: String,
    /// 標準方案輸入價格 — 免費欄（原始文字）
    pub input_free: String,
    /// 標準方案輸入價格 — 付費欄（原始文字，含換行）
    pub input_paid: String,
    /// 標準方案輸出價格 — 免費欄
    pub output_free: String,
    /// 標準方案輸出價格 — 付費欄
    pub output_paid: String,
    /// 供排序用：付費輸入第一個 $數字，找不到時為 f64::MAX
    pub sort_price: f64,
}

/// 從 HTML 文字解析 Gemini 定價
fn parse_pricing_html(html: &str) -> Vec<ModelPricing> {
    use scraper::{Html, Selector};

    let document = Html::parse_document(html);
    let section_sel = Selector::parse(".models-section").unwrap();
    let code_sel    = Selector::parse("em > code").unwrap();
    let h2_sel      = Selector::parse("h2").unwrap();

    fn extract_first_dollar(text: &str) -> f64 {
        let mut chars = text.chars().peekable();
        while let Some(c) = chars.next() {
            if c == '$' {
                let num: String = chars
                    .by_ref()
                    .take_while(|ch| ch.is_ascii_digit() || *ch == '.')
                    .collect();
                if let Ok(v) = num.parse::<f64>() {
                    return v;
                }
            }
        }
        f64::MAX
    }

    // 把 td 的 text nodes 用換行合併（<br> 在 scraper 裡是獨立 text node 之間的分隔）
    fn td_text(el: &scraper::ElementRef) -> String {
        el.text().collect::<Vec<_>>().join("\n").trim().to_string()
    }

    let mut results = Vec::new();

    for section_el in document.select(&section_sel) {
        // 收集這個 section 裡所有 <em><code> 的 model id（有些條目共用一個定價區塊）
        let model_ids: Vec<String> = section_el
            .select(&code_sel)
            .map(|el| el.text().collect::<String>().trim().to_string())
            .filter(|id| !id.is_empty() && id.starts_with("gemini-"))
            .collect();
        if model_ids.is_empty() {
            continue;
        }
        let model_id = model_ids[0].clone();
        if model_id.is_empty() || !model_id.starts_with("gemini-") {
            continue;
        }

        let h2_id = section_el
            .select(&h2_sel)
            .find(|el| el.value().attr("id").is_some())
            .and_then(|el| el.value().attr("id"))
            .unwrap_or("")
            .to_string();
        if h2_id.is_empty() {
            continue;
        }

        let start_marker = format!("id=\"{}\"", h2_id);
        let start_pos = match html.find(&start_marker) {
            Some(p) => p,
            None => continue,
        };
        let end_pos = html[start_pos + 1..]
            .find("class=\"models-section\"")
            .map(|p| start_pos + 1 + p)
            .unwrap_or(html.len());

        let chunk = &html[start_pos..end_pos];
        let chunk_doc = Html::parse_fragment(chunk);
        let table_sel = Selector::parse("table.pricing-table tbody tr").unwrap();
        let td_sel    = Selector::parse("td").unwrap();

        let mut input_free  = String::new();
        let mut input_paid  = String::new();
        let mut output_free = String::new();
        let mut output_paid = String::new();

        // 只看第一個 table（標準方案），第二次出現「輸入價格」代表進入批次 table，停止
        let mut row_count = 0;

        for row in chunk_doc.select(&table_sel) {
            let tds: Vec<_> = row.select(&td_sel).collect();
            if tds.len() < 3 {
                continue;
            }
            let label = tds[0].text().collect::<String>();

            if label.contains("輸入價格") {
                if row_count > 0 {
                    break;
                }
                row_count += 1;
            }

            if label.contains("輸入價格") {
                input_free = td_text(&tds[1]);
                input_paid = td_text(&tds[2]);
            } else if label.contains("輸出價格") && output_free.is_empty() {
                output_free = td_text(&tds[1]);
                output_paid = td_text(&tds[2]);
            }
        }

        if input_paid.is_empty() {
            continue;
        }

        let sort_price = extract_first_dollar(&input_paid);

        // 同一個定價區塊可能對應多個 model id（如 customtools variant）
        for mid in model_ids {
            results.push(ModelPricing {
                model_id: mid,
                input_free: input_free.clone(),
                input_paid: input_paid.clone(),
                output_free: output_free.clone(),
                output_paid: output_paid.clone(),
                sort_price,
            });
        }
    }

    results
}

/// 抓取 Gemini 定價頁並快取到 app data dir（每天最多一次）
/// 回傳 Vec<ModelPricing>（依輸入價格由低到高排序）
#[command]
pub async fn fetch_gemini_pricing(app: tauri::AppHandle) -> Result<Vec<ModelPricing>, String> {
    use std::fs;
    use chrono::Local;

    let pricing_url = "https://ai.google.dev/gemini-api/docs/pricing?hl=zh-tw";

    // 快取檔案放在 app data dir
    let cache_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("無法取得 app data dir: {}", e))?;
    fs::create_dir_all(&cache_dir).map_err(|e| format!("建立快取目錄失敗: {}", e))?;

    let cache_html  = cache_dir.join("gemini_pricing.html");
    let cache_date  = cache_dir.join("gemini_pricing_date.txt");

    let today = Local::now().format("%Y-%m-%d").to_string();

    // 判斷是否需要重新抓取
    let need_fetch = match fs::read_to_string(&cache_date) {
        Ok(date) => date.trim() != today,
        Err(_)   => true,
    };

    if need_fetch {
        let client = reqwest::Client::builder()
            .user_agent("Mozilla/5.0 (compatible; STTAgent/1.0)")
            .build()
            .map_err(|e| format!("建立 HTTP client 失敗: {}", e))?;

        let resp = client
            .get(pricing_url)
            .send()
            .await
            .map_err(|e| format!("無法連線至 Gemini 定價頁: {}", e))?;

        if !resp.status().is_success() {
            return Err(format!("定價頁回傳錯誤 HTTP {}", resp.status()));
        }

        let html = resp.text().await.map_err(|e| format!("讀取回應失敗: {}", e))?;
        fs::write(&cache_html, &html).map_err(|e| format!("寫入快取失敗: {}", e))?;
        fs::write(&cache_date, &today).map_err(|e| format!("寫入日期快取失敗: {}", e))?;
    }

    let html = fs::read_to_string(&cache_html)
        .map_err(|e| format!("讀取快取失敗: {}", e))?;

    let mut pricing = parse_pricing_html(&html);
    pricing.sort_by(|a, b| a.sort_price.partial_cmp(&b.sort_price).unwrap());
    Ok(pricing)
}

/// 舊的命令 (保留向後相容)
#[command]
#[deprecated(note = "使用 generate_report 替代")]
#[allow(deprecated)]
pub async fn run_report_cmd(_api_key: String) -> Result<String, String> {
    Err("請使用新的 generate_report 命令".to_string())
}
