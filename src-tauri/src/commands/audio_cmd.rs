// src-tauri/src/commands/audio_cmd.rs
use crate::services::file_manager::{CurrentProjectState, ProjectPaths};
use crate::services::{Converter, Silence, Splitter};
use tauri::command;

/// 取得系統下載資料夾路徑 (跨平台)
/// Windows: C:\Users\使用者\Downloads
/// Linux: /home/使用者/Downloads
/// macOS: /Users/使用者/Downloads
fn get_download_dir() -> String {
    dirs::download_dir()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|| {
            dirs::home_dir()
                .map(|p| p.join("Downloads").to_string_lossy().to_string())
                .unwrap_or_else(|| ".".to_string())
        })
}

#[command]
pub fn run_convert_cmd() -> String {
    format!("Converter 已就緒，輸出目錄: {}", get_download_dir())
}

/// 轉換多個檔案為 MP3
#[command]
pub async fn convert_files_to_mp3(
    app: tauri::AppHandle,
    state: tauri::State<'_, CurrentProjectState>,
    file_paths: Vec<String>,
) -> Result<String, String> {
    if file_paths.is_empty() {
        return Err("未選擇任何檔案".to_string());
    }

    let converter = Converter::new();
    let mut success_count = 0;
    let mut fail_count = 0;
    let mut messages = Vec::new();

    // 用於最後顯示路徑
    let first_file_path = file_paths.first().cloned();

    let current_project_root = state.lock().unwrap().clone();

    // 針對每一個檔案，都必須建立其專屬的 Project Folder
    for path in file_paths {
        // 1. 初始化專案路徑
        let project_paths_result = if let Some(root) = &current_project_root {
            ProjectPaths::from_root(root.clone())
        } else {
            ProjectPaths::new(&path)
        };

        let project_paths = match project_paths_result {
            Ok(p) => p,
            Err(e) => {
                fail_count += 1;
                messages.push(format!("✗ {} - 路徑錯誤: {}", path, e));
                continue;
            }
        };

        // 2. 建立資料夾
        if let Err(e) = project_paths.create_all_dirs() {
            fail_count += 1;
            messages.push(format!("✗ {} - 無法建立資料夾: {}", path, e));
            continue;
        }

        let output_dir = project_paths.converted.to_string_lossy().to_string();

        // 3. 執行單一轉檔
        match converter.convert_to_mp3(&app, &path, &output_dir).await {
            Ok(output_path) => {
                success_count += 1;
                messages.push(format!("✓ {}", output_path));
            }
            Err(e) => {
                fail_count += 1;
                messages.push(format!("✗ {} - {}", path, e));
            }
        }
    }

    // 4. 計算最後顯示的根目錄路徑
    let root_path_display = if let Some(path) = first_file_path {
        if let Ok(p) = crate::services::ProjectPaths::new(&path) {
            p.root
                .parent()
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_else(|| "Unknown".to_string())
        } else {
            "Unknown".to_string()
        }
    } else {
        "Unknown".to_string()
    };

    let result_msg = format!(
        "轉檔完成！成功: {} 個，失敗: {} 個\n檔案位置: {}\n(已依照檔名自動分類專案資料夾)\n\n{}",
        success_count,
        fail_count,
        root_path_display,
        messages.join("\n")
    );

    Ok(result_msg)
}

#[command]
pub fn set_project_root_dir(path: String) -> Result<String, String> {
    crate::services::ProjectPaths::set_custom_root(path.clone())
        .map(|_| format!("成功設定預設專案路徑為: {}", path))
}

#[command]
#[deprecated(note = "使用 split_audio_segments 替代")]
#[allow(deprecated)]
pub fn run_split_cmd() -> String {
    let splitter = Splitter::new();
    splitter.execute();
    "Split 完成 (Layered Arch)".to_string()
}

#[command]
pub fn run_silence_cmd() -> String {
    let silence = Silence::new();
    silence.execute();
    "Silence 完成 (Layered Arch)".to_string()
}

/// 段落資訊（從前端傳入）
#[derive(serde::Deserialize)]
pub struct SegmentInfo {
    pub name: String,
    #[serde(rename = "startTime")]
    pub start_time: String,
    #[serde(rename = "endTime")]
    pub end_time: String,
}

/// 切割音訊檔案
/// 根據傳入的段落列表，將音檔切割成多個片段
#[command]
pub async fn split_audio_segments(
    app: tauri::AppHandle,
    state: tauri::State<'_, CurrentProjectState>,
    audio_path: String,
    segments: Vec<SegmentInfo>,
    prefix_index: bool,
) -> Result<String, String> {
    if audio_path.is_empty() {
        return Err("未載入音訊檔案".to_string());
    }

    if segments.is_empty() {
        return Err("未設定任何段落".to_string());
    }

    // 驗證段落資料
    for (i, seg) in segments.iter().enumerate() {
        if seg.name.trim().is_empty() {
            return Err(format!("第 {} 個段落名稱不能為空", i + 1));
        }
        if seg.start_time.is_empty() || seg.end_time.is_empty() {
            return Err(format!("第 {} 個段落 '{}' 的時間不完整", i + 1, seg.name));
        }
    }

    let current_project_root = state.lock().unwrap().clone();

    // 使用 ProjectPaths 建立輸出目錄 (02_split)
    let project_paths = if let Some(root) = &current_project_root {
        ProjectPaths::from_root(root.clone())?
    } else {
        crate::services::ProjectPaths::new(&audio_path)?
    };

    project_paths.create_all_dirs()?;
    let output_dir_str = project_paths.split.to_string_lossy().to_string();

    // 轉換段落資料格式，若 prefix_index 則加上順序前綴
    let segment_tuples: Vec<(String, String, String)> = segments
        .into_iter()
        .enumerate()
        .map(|(i, s)| {
            let name = if prefix_index {
                format!("{}{}", i + 1, s.name)
            } else {
                s.name
            };
            (name, s.start_time, s.end_time)
        })
        .collect();

    // 執行切割
    let splitter = Splitter::new();
    let output_files = splitter
        .split_segments(&app, &audio_path, &output_dir_str, segment_tuples)
        .await?;

    Ok(format!(
        "切割完成！共產生 {} 個檔案\n輸出目錄: {}\n\n{}",
        output_files.len(),
        output_dir_str,
        output_files.join("\n")
    ))
}

#[command]
pub fn list_audio_files(dir_path: String) -> Result<Vec<String>, String> {
    use std::fs;
    use std::path::Path;

    let path = Path::new(&dir_path);
    if !path.exists() || !path.is_dir() {
        return Err("目錄不存在或無效".to_string());
    }

    let mut files = Vec::new();
    let entries = fs::read_dir(path).map_err(|e| e.to_string())?;

    for entry in entries {
        if let Ok(entry) = entry {
            let path = entry.path();
            if path.is_file() {
                if let Some(ext) = path.extension().and_then(|s| s.to_str()) {
                    let ext = ext.to_lowercase();
                    if ["mp3", "wav", "flac", "m4a", "aac", "ogg"].contains(&ext.as_str()) {
                        if let Some(name) = path.file_name().and_then(|s| s.to_str()) {
                            files.push(name.to_string());
                        }
                    }
                }
            }
        }
    }

    files.sort();
    Ok(files)
}

#[derive(serde::Deserialize)]
pub struct SilenceSegment {
    pub note: Option<String>,
    #[serde(rename = "startTime")]
    pub start_time: String,
    #[serde(rename = "endTime")]
    pub end_time: String,
}

/// 執行手動消音處理
#[command]
pub async fn apply_silence_command(
    app: tauri::AppHandle,
    state: tauri::State<'_, CurrentProjectState>,
    audio_path: String,
    segments: Vec<SilenceSegment>,
) -> Result<String, String> {
    use crate::services::Silence;

    if audio_path.is_empty() {
        return Err("未載入音訊檔案".to_string());
    }
    if segments.is_empty() {
        return Err("未設定任何消音時段".to_string());
    }

    // Helper to parse "HH:MM:SS.mmm" or "SS.mmm" to seconds
    fn parse_time(t: &str) -> Result<f64, String> {
        let parts: Vec<&str> = t.split(':').collect();
        match parts.len() {
            3 => {
                let h: f64 = parts[0].parse().map_err(|_| "Invalid hour")?;
                let m: f64 = parts[1].parse().map_err(|_| "Invalid minute")?;
                let s: f64 = parts[2].parse().map_err(|_| "Invalid second")?;
                Ok(h * 3600.0 + m * 60.0 + s)
            }
            2 => {
                let m: f64 = parts[0].parse().map_err(|_| "Invalid minute")?;
                let s: f64 = parts[1].parse().map_err(|_| "Invalid second")?;
                Ok(m * 60.0 + s)
            }
            1 => parts[0]
                .parse()
                .map_err(|_| format!("Invalid time format: {}", t)),
            _ => Err(format!("Invalid time format: {}", t)),
        }
    }

    let mut parsed_segments = Vec::new();
    for seg in segments {
        let start = parse_time(&seg.start_time).map_err(|e| format!("開始時間格式錯誤: {}", e))?;
        let end = parse_time(&seg.end_time).map_err(|e| format!("結束時間格式錯誤: {}", e))?;

        if start < 0.0 {
            return Err(format!("開始時間不能為負數 ({})", seg.start_time));
        }
        if end < 0.0 {
            return Err(format!("結束時間不能為負數 ({})", seg.end_time));
        }
        if start >= end {
            return Err(format!(
                "開始時間必須小於結束時間 ({}-{})",
                seg.start_time, seg.end_time
            ));
        }
        parsed_segments.push((start, end));
    }

    let current_project_root = state.lock().unwrap().clone();

    // 建立輸出目錄 (03_silence)
    let project_paths = if let Some(root) = &current_project_root {
        ProjectPaths::from_root(root.clone())?
    } else {
        crate::services::ProjectPaths::new(&audio_path)?
    };

    project_paths.create_all_dirs()?;
    let output_dir_str = project_paths.silence.to_string_lossy().to_string();

    // 檢查 03_silence 是否為空
    // 規則：若是第一次執行 (03 為空)，將 02_split 下的所有檔案 複製 (Copy) 過來
    // 這樣 02_split 保留所有原始檔，03_silence 則作為報告用的工作目錄
    let silence_dir = &project_paths.silence;
    if let Ok(entries) = std::fs::read_dir(silence_dir) {
        if entries.count() == 0 {
            // 03_silence 為空，執行複製
            if let Ok(split_entries) = std::fs::read_dir(&project_paths.split) {
                for entry in split_entries {
                    if let Ok(entry) = entry {
                        let path = entry.path();
                        if path.is_file() {
                            if let Some(file_name) = path.file_name() {
                                let dest_path = silence_dir.join(file_name);
                                if let Err(e) = std::fs::copy(&path, &dest_path) {
                                    println!("Failed to copy file {:?} to 03_silence: {}", path, e);
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    let silence_service = Silence::new();
    let output_path = silence_service
        .apply_silence_to_segments(&app, &audio_path, &output_dir_str, parsed_segments)
        .await?;

    // 處理完成後，將該檔案的"原始檔"從 03_silence 中移除 (如果存在)
    // 根據需求：03_silence 應該只保留"已處理的檔案"以及"尚未處理的其他檔案"
    // 當某個檔案被處理成 xxx_silenced.mp3 後，原本在 03_silence 的 xxx.mp3 就應該移除，避免重複
    if let Some(file_name) = std::path::Path::new(&audio_path).file_name() {
        let original_in_silence = project_paths.silence.join(file_name);
        if original_in_silence.exists() && original_in_silence.is_file() {
            // 確認一下不是刪除剛產生的 output_path (雖然檔名應該不同，output 有 suffix)
            // 這裡簡單檢查一下路徑是否完全相同
            if original_in_silence.to_string_lossy() != output_path {
                let _ = std::fs::remove_file(original_in_silence);
            }
        }
    }

    Ok(format!("消音處理完成！\n輸出檔案: {}", output_path))
}
