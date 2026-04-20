use serde::{Deserialize, Serialize};
use std::path::Path;
use tauri::AppHandle;
use tauri_plugin_shell::ShellExt;

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Segment {
    pub start: f64,
    pub end: f64,
    pub text: String,
    pub name: String,
    pub start_idx: Option<usize>,
    pub end_idx: Option<usize>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct TranscribeResponse {
    pub filename: String,
    pub duration: f64,
    pub segments: Vec<Segment>,
    pub full_text: String,
}

pub struct Silence {
    http_client: reqwest::Client,
}

impl Silence {
    pub fn new() -> Self {
        Self {
            http_client: reqwest::Client::new(),
        }
    }

    pub async fn check_health(&self, ip: &str) -> bool {
        let url = format!("{}/health", ip.trim_end_matches('/'));
        match self
            .http_client
            .get(&url)
            .timeout(std::time::Duration::from_secs(2))
            .send()
            .await
        {
            Ok(resp) => resp.status().is_success(),
            Err(_) => false,
        }
    }

    pub async fn transcribe(
        &self,
        ip: &str,
        file_path: &str,
    ) -> Result<TranscribeResponse, String> {
        let url = format!("{}/transcribe", ip.trim_end_matches('/'));

        let file_path = Path::new(file_path);
        if !file_path.exists() {
            return Err(format!("File not found: {:?}", file_path));
        }

        // Create multipart form
        let form = reqwest::multipart::Form::new()
            .file("file", file_path)
            .await
            .map_err(|e| format!("Failed to create multipart form: {}", e))?;

        let resp = self
            .http_client
            .post(&url)
            .multipart(form)
            .timeout(std::time::Duration::from_secs(300))
            .send()
            .await
            .map_err(|e| format!("Request failed: {}", e))?;

        if !resp.status().is_success() {
            return Err(format!("Server returned error: {}", resp.status()));
        }

        let result = resp
            .json::<TranscribeResponse>()
            .await
            .map_err(|e| format!("Failed to parse response: {}", e))?;

        Ok(result)
    }

    pub fn execute(&self) {
        println!("(Silence) 正在執行音訊消音處理 (Service Layer)...");
    }

    /// 對多個時段進行消音處理
    /// segments: Vec<(startTime, endTime)> (單位：秒，支援小數)
    pub async fn apply_silence_to_segments(
        &self,
        app: &AppHandle,
        input_path: &str,
        output_dir: &str,
        segments: Vec<(f64, f64)>,
    ) -> Result<String, String> {
        if segments.is_empty() {
            return Err("沒有指定消音時段".to_string());
        }

        let input_path_obj = Path::new(input_path);
        let file_stem = input_path_obj
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("output");
        let ext = input_path_obj
            .extension()
            .and_then(|s| s.to_str())
            .unwrap_or("mp3");

        // 確保輸出目錄存在
        std::fs::create_dir_all(output_dir).map_err(|e| format!("無法建立輸出目錄: {}", e))?;

        let output_path = format!("{}/{}_silenced.{}", output_dir, file_stem, ext);

        // 建構 FFmpeg volume filter
        // 語法: volume=enable='between(t,start1,end1)+between(t,start2,end2)':volume=0
        let mut filter_parts = Vec::new();
        for (start, end) in segments {
            filter_parts.push(format!("between(t,{:.3},{:.3})", start, end));
        }
        let filter_expr = filter_parts.join("+");
        let filter_arg = format!("volume=enable='{}':volume=0", filter_expr);

        println!("Applying Silence Filter: {}", filter_arg);

        let output = app
            .shell()
            .sidecar("ffmpeg")
            .map_err(|e| format!("無法建立 FFmpeg Sidecar: {}", e))?
            .args([
                "-i",
                input_path,
                "-af",
                &filter_arg,
                "-c:v",
                "copy", // Copy video if present (though usually audio only)
                // re-encode audio is required for filters to work
                "-y",
                &output_path,
            ])
            .output()
            .await
            .map_err(|e| format!("FFmpeg 執行失敗: {}", e))?;

        if output.status.success() {
            Ok(output_path)
        } else {
            let stderr = String::from_utf8_lossy(&output.stderr);
            Err(format!("FFmpeg 消音處理失敗: {}", stderr))
        }
    }
}
