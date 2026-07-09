// src-tauri/src/commands/media_split_cmd.rs
//
// 「其他工具」分類底下的獨立影片切割功能。
// 與 audio_cmd::split_audio_segments 的差異：不綁定專案資料夾結構（01_converted/02_split/...），
// 而是直接輸出到使用者指定的資料夾，供 MP4 等非標準工作流程使用。
use crate::services::Splitter;
use tauri::command;

#[derive(serde::Deserialize)]
pub struct MediaSegmentInfo {
    pub name: String,
    #[serde(rename = "startTime")]
    pub start_time: String,
    #[serde(rename = "endTime")]
    pub end_time: String,
}

#[command]
pub async fn split_media_segments(
    app: tauri::AppHandle,
    media_path: String,
    output_dir: String,
    segments: Vec<MediaSegmentInfo>,
) -> Result<String, String> {
    if media_path.is_empty() {
        return Err("未載入影片檔案".to_string());
    }
    if output_dir.is_empty() {
        return Err("未選擇輸出資料夾".to_string());
    }
    if segments.is_empty() {
        return Err("未設定任何段落".to_string());
    }

    for (i, seg) in segments.iter().enumerate() {
        if seg.name.trim().is_empty() {
            return Err(format!("第 {} 個段落名稱不能為空", i + 1));
        }
        if seg.start_time.is_empty() || seg.end_time.is_empty() {
            return Err(format!("第 {} 個段落 '{}' 的時間不完整", i + 1, seg.name));
        }
    }

    let segment_tuples: Vec<(String, String, String)> = segments
        .into_iter()
        .map(|s| (s.name, s.start_time, s.end_time))
        .collect();

    let splitter = Splitter::new();
    let output_files = splitter
        .split_segments(&app, &media_path, &output_dir, segment_tuples)
        .await?;

    Ok(format!(
        "切割完成！共產生 {} 個檔案\n輸出目錄: {}\n\n{}",
        output_files.len(),
        output_dir,
        output_files.join("\n")
    ))
}
