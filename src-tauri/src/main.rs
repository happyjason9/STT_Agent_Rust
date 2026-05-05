// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

// src-tauri/src/main.rs

use std::sync::Mutex;
use stt_agent_rust_lib::commands;
use stt_agent_rust_lib::commands::player_cmd::AudioPlayerState;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        // Manage AudioPlayer state with Mutex<Option<AudioPlayer>>
        .manage(Mutex::new(None::<stt_agent_rust_lib::services::AudioPlayer>) as AudioPlayerState)
        .manage(stt_agent_rust_lib::services::silence::Silence::new())
        .manage(
            Mutex::new(None::<std::path::PathBuf>)
                as stt_agent_rust_lib::services::file_manager::CurrentProjectState,
        )
        .invoke_handler(tauri::generate_handler![
            commands::audio_cmd::run_convert_cmd,
            commands::audio_cmd::convert_files_to_mp3,
            commands::audio_cmd::set_project_root_dir,
            #[allow(deprecated)]
            commands::audio_cmd::run_split_cmd,
            commands::audio_cmd::run_silence_cmd,
            commands::audio_cmd::split_audio_segments,
            commands::audio_cmd::list_audio_files,
            commands::audio_cmd::apply_silence_command,
            #[allow(deprecated)]
            commands::report_cmd::run_report_cmd,
            commands::report_cmd::generate_report,
            commands::report_cmd::get_default_prompt,
            commands::report_cmd::read_custom_prompt,
            commands::report_cmd::convert_md_to_docx,
            commands::report_cmd::list_gemini_models,
            commands::app_cmd::exit_app,
            commands::app_cmd::uninstall_app,
            // Audio player commands
            commands::player_cmd::load_track,
            commands::player_cmd::play,
            commands::player_cmd::pause,
            commands::player_cmd::seek,
            commands::player_cmd::get_playback_state,
            // Silence & Auto-Silence
            commands::silence_cmd::connect_server,
            commands::silence_cmd::transcribe_audio,
            commands::silence_cmd::silence_audio,
            // Project Commands
            commands::project_cmd::create_project_cmd,
            commands::project_cmd::open_project_cmd,
            commands::project_cmd::get_current_project_cmd,
            commands::project_cmd::new_window_cmd,
            // File Commands
            commands::file_cmd::save_text_file,
            commands::file_cmd::read_text_file,
            commands::file_cmd::check_file_exists,
            commands::file_cmd::ensure_dir_exists,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
