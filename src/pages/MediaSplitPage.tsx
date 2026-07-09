import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { useI18n } from "../i18n";

interface PlaybackState {
    position: number;
    duration: number;
    is_playing: boolean;
}

// 段落資料結構
interface Segment {
    id: number;
    name: string;
    startTime: string; // HH:MM:SS 格式
    endTime: string;   // HH:MM:SS 格式
}

// 自動格式化時間輸入：01 -> 01, 0112 -> 01:12, 011223 -> 01:12:23
function formatTimeString(input: string): string {
    const digits = input.replace(/\D/g, "");
    const limited = digits.slice(0, 6);

    if (limited.length <= 2) {
        return limited;
    } else if (limited.length <= 4) {
        const secs = limited.slice(-2);
        const mins = limited.slice(0, -2);
        return `${mins}:${secs}`;
    } else {
        const secs = limited.slice(-2);
        const mins = limited.slice(-4, -2);
        const hours = limited.slice(0, -4);
        return `${hours}:${mins}:${secs}`;
    }
}

export function MediaSplitPage() {
    const { t, language } = useI18n();
    const [output, setOutput] = useState("");
    const [loading, setLoading] = useState(false);

    // Audio/Video player state (重用 player_cmd，可解碼 mp4 內的音軌試聽)
    const [isPlaying, setIsPlaying] = useState(false);
    const [duration, setDuration] = useState(0);
    const [currentTime, setCurrentTime] = useState(0);
    const [isLoaded, setIsLoaded] = useState(false);
    const [isSeeking, setIsSeeking] = useState(false);
    const [mediaFilePath, setMediaFilePath] = useState("");
    const [outputDir, setOutputDir] = useState("");

    const [segments, setSegments] = useState<Segment[]>([
        { id: 1, name: "", startTime: "", endTime: "" }
    ]);
    const [nextId, setNextId] = useState(2);

    const [hoverTime, setHoverTime] = useState<number | null>(null);
    const [hoverPosition, setHoverPosition] = useState<number>(0);

    const [markPoint1, setMarkPoint1] = useState<number | null>(null);
    const [markPoint2, setMarkPoint2] = useState<number | null>(null);
    const [segmentNameInput, setSegmentNameInput] = useState("");

    const positionIntervalRef = useRef<number | null>(null);

    const lastKeyRef = useRef<{ key: string, time: number }>({ key: '', time: 0 });
    const handleNumpadWorkaround = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.code && e.code.startsWith('Numpad')) {
            const now = e.timeStamp;
            if (e.key === lastKeyRef.current.key && now - lastKeyRef.current.time < 50) {
                e.preventDefault();
            }
            lastKeyRef.current = { key: e.key, time: now };
        }
    };

    useEffect(() => {
        async function syncWithBackend() {
            try {
                const state = await invoke<PlaybackState>("get_playback_state");
                if (state.duration > 0) {
                    setDuration(state.duration);
                    setCurrentTime(state.position);
                    setIsPlaying(state.is_playing);
                    setIsLoaded(true);
                }
            } catch (err) {
                console.log("No media loaded yet");
            }
        }
        syncWithBackend();
    }, []);

    useEffect(() => {
        if (isPlaying && !isSeeking) {
            positionIntervalRef.current = window.setInterval(async () => {
                try {
                    const state = await invoke<PlaybackState>("get_playback_state");
                    setCurrentTime(state.position);
                    setIsPlaying(state.is_playing);
                } catch (err) {
                    console.error("Failed to get playback state:", err);
                }
            }, 100);
        }

        return () => {
            if (positionIntervalRef.current) {
                clearInterval(positionIntervalRef.current);
                positionIntervalRef.current = null;
            }
        };
    }, [isPlaying, isSeeking]);

    useEffect(() => {
        const handleKeyDown = async (e: KeyboardEvent) => {
            if (!isLoaded) return;
            if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

            const SKIP_SECONDS = 5;

            switch (e.key) {
                case "ArrowLeft":
                    e.preventDefault();
                    const newTimeBack = Math.max(0, currentTime - SKIP_SECONDS);
                    try {
                        await invoke("seek", { seconds: newTimeBack });
                        setCurrentTime(newTimeBack);
                    } catch (err) {
                        console.error("Seek error:", err);
                    }
                    break;

                case "ArrowRight":
                    e.preventDefault();
                    const newTimeForward = Math.min(duration, currentTime + SKIP_SECONDS);
                    try {
                        await invoke("seek", { seconds: newTimeForward });
                        setCurrentTime(newTimeForward);
                    } catch (err) {
                        console.error("Seek error:", err);
                    }
                    break;

                case " ":
                    e.preventDefault();
                    handlePlayPause();
                    break;
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [isLoaded, currentTime, duration, isPlaying]);

    // 載入影片/音訊檔（含 mp4）
    async function handleLoadTrack() {
        try {
            const selected = await open({
                multiple: false,
                filters: [
                    {
                        name: language === "zh" ? "影音檔案" : "Audio/Video Files",
                        extensions: ["mp4", "mov", "mkv", "mp3", "wav", "flac", "m4a", "aac", "ogg"],
                    },
                ],
            });

            if (selected && typeof selected === "string") {
                setLoading(true);
                setOutput(t.loading);

                const durationStr = await invoke<string>("load_track", { path: selected });
                const dur = parseFloat(durationStr);

                setDuration(dur);
                setCurrentTime(0);
                setIsLoaded(true);
                setIsPlaying(false);
                setMediaFilePath(selected);
                setOutput(`${t.loaded}: ${selected.split(/[/\\]/).pop()}`);

                // 預設輸出資料夾：與來源檔同層的資料夾
                if (!outputDir) {
                    const separator = selected.includes("\\") ? "\\" : "/";
                    const parentDir = selected.substring(0, selected.lastIndexOf(separator));
                    setOutputDir(parentDir);
                }
            }
        } catch (err) {
            setOutput(`${t.error}: ${err}`);
        } finally {
            setLoading(false);
        }
    }

    async function handleSelectOutputDir() {
        try {
            const selected = await open({ directory: true, multiple: false });
            if (selected && typeof selected === "string") {
                setOutputDir(selected);
            }
        } catch (err) {
            setOutput(`${t.error}: ${err}`);
        }
    }

    async function handlePlayPause() {
        try {
            if (isPlaying) {
                await invoke("pause");
                setIsPlaying(false);
            } else {
                await invoke("play");
                setIsPlaying(true);
            }
        } catch (err) {
            setOutput(`${t.error}: ${err}`);
        }
    }

    async function handleSeek(seconds: number) {
        try {
            await invoke("seek", { seconds });
            setCurrentTime(seconds);
        } catch (err) {
            setOutput(`Seek ${t.error}: ${err}`);
        }
    }

    function formatTime(seconds: number): string {
        const hours = Math.floor(seconds / 3600);
        const mins = Math.floor((seconds % 3600) / 60);
        const secs = Math.floor(seconds % 60);
        return `${hours.toString().padStart(2, "0")}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
    }

    const handleMouseMove = (e: React.MouseEvent<HTMLInputElement>) => {
        if (!duration) return;
        const rect = e.currentTarget.getBoundingClientRect();
        let percent = (e.clientX - rect.left) / rect.width;
        percent = Math.max(0, Math.min(1, percent));
        setHoverTime(percent * duration);
        setHoverPosition(percent * 100);
    };

    const handleMouseLeave = () => {
        setHoverTime(null);
    };

    const handleContextMenu = (e: React.MouseEvent<HTMLInputElement>) => {
        e.preventDefault();
        if (!duration) return;

        const rect = e.currentTarget.getBoundingClientRect();
        let percent = (e.clientX - rect.left) / rect.width;
        percent = Math.max(0, Math.min(1, percent));
        const clickedTime = percent * duration;

        if (markPoint1 === null) {
            setMarkPoint1(clickedTime);
            setMarkPoint2(null);
            setSegmentNameInput("");
        } else if (markPoint2 === null) {
            setMarkPoint2(clickedTime);
        } else {
            setMarkPoint1(clickedTime);
            setMarkPoint2(null);
            setSegmentNameInput("");
        }
    };

    const handleCancelMark = () => {
        setMarkPoint1(null);
        setMarkPoint2(null);
        setSegmentNameInput("");
    };

    const handleConfirmMark = () => {
        if (markPoint1 === null || markPoint2 === null) return;

        const start = Math.min(markPoint1, markPoint2);
        const end = Math.max(markPoint1, markPoint2);

        const newSegment: Segment = {
            id: nextId,
            name: segmentNameInput.trim(),
            startTime: formatTime(start),
            endTime: formatTime(end)
        };

        setSegments([...segments, newSegment]);
        setNextId(nextId + 1);
        handleCancelMark();
    };

    function addSegment() {
        const newSegment: Segment = {
            id: nextId,
            name: "",
            startTime: "",
            endTime: ""
        };
        setSegments([...segments, newSegment]);
        setNextId(nextId + 1);
    }

    function deleteSegment(id: number) {
        if (segments.length > 1) {
            setSegments(segments.filter(s => s.id !== id));
        }
    }

    function updateSegment(id: number, field: keyof Segment, value: string) {
        let formattedValue = value;
        if (field === "startTime" || field === "endTime") {
            formattedValue = formatTimeString(value);
        }

        setSegments(segments.map(s =>
            s.id === id ? { ...s, [field]: formattedValue } : s
        ));
    }

    async function runSplit() {
        if (!mediaFilePath) {
            setOutput(`${t.error}: ${t.errorLoadAudio}`);
            return;
        }
        if (!outputDir) {
            setOutput(`${t.error}: ${t.mediaSplitErrorNoOutputDir}`);
            return;
        }

        const validSegments = segments.filter(
            (s) => s.name.trim() && s.startTime && s.endTime
        );
        if (validSegments.length === 0) {
            setOutput(`${t.error}: ${t.errorSetSegment}`);
            return;
        }

        setLoading(true);
        setOutput(t.processing);

        try {
            const result = await invoke("split_media_segments", {
                mediaPath: mediaFilePath,
                outputDir: outputDir,
                segments: validSegments.map((s) => ({
                    name: s.name.trim(),
                    startTime: s.startTime,
                    endTime: s.endTime,
                })),
            });
            setOutput(result as string);
        } catch (err) {
            setOutput(`${t.error}: ${err}`);
        } finally {
            setLoading(false);
        }
    }

    const MediaIcon = () => (
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.8 }}>
            <rect x="2" y="4" width="20" height="16" rx="2" />
            <path d="M10 9l5 3-5 3z" />
        </svg>
    );
    const PlayIcon = () => (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" stroke="none">
            <path d="M8 5v14l11-7z"></path>
        </svg>
    );

    const PauseIcon = () => (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" stroke="none">
            <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"></path>
        </svg>
    );

    return (
        <div className="page-container">
            <header className="page-header">
                <h2 className="page-title">{t.mediaSplitTitle}</h2>
                <p className="page-description">{t.mediaSplitDescription}</p>
            </header>

            <div className={`audio-player-wrapper ${isLoaded ? 'active' : 'empty'}`}>
                {!isLoaded ? (
                    <div className="audio-empty-state">
                        <h3 style={{ marginBottom: '16px' }}>🎬 {t.mediaSplitTitle}</h3>
                        <div className="audio-icon-circle">
                            <MediaIcon />
                        </div>
                        <p className="subtext">{t.errorLoadAudio}</p>
                        <button className="btn btn-primary mt-3" onClick={handleLoadTrack} disabled={loading}>
                            📂 {t.loadAudio}
                        </button>
                    </div>
                ) : (
                    <div className="audio-controls-container">
                        <div style={{ marginBottom: '16px' }}>
                            <h3 style={{ margin: '0 0 12px 0' }}>🎬 {t.mediaSplitTitle}</h3>
                            <button className="btn btn-secondary" onClick={handleLoadTrack}>
                                📂 {t.changeFolder || t.loadAudio}
                            </button>
                        </div>

                        <div className="player-inner-box">
                            <div className="player-top-row">
                                <div className="track-info">
                                    <span className="icon">🎬</span>
                                    <span className="track-name">{getFileName(mediaFilePath)}</span>
                                </div>
                            </div>

                            <div className="player-main-row">
                                <button className="play-btn" onClick={handlePlayPause}>
                                    {isPlaying ? <PauseIcon /> : <PlayIcon />}
                                </button>

                                <div className="seek-container">
                                    <span className="time-display">{formatTime(currentTime)}</span>
                                    <div style={{ position: 'relative', flex: 1, display: 'flex', alignItems: 'center' }}>
                                        {hoverTime !== null && (
                                            <div
                                                className="progress-tooltip"
                                                style={{ left: `${hoverPosition}%` }}
                                            >
                                                {formatTime(hoverTime)}
                                            </div>
                                        )}

                                        {markPoint1 !== null && duration > 0 && (
                                            <div
                                                className="mark-line-primary"
                                                style={{ left: `${(markPoint1 / duration) * 100}%` }}
                                            />
                                        )}

                                        {markPoint2 !== null && duration > 0 && (
                                            <div
                                                className="mark-line-secondary"
                                                style={{ left: `${(markPoint2 / duration) * 100}%` }}
                                            />
                                        )}

                                        {markPoint1 !== null && markPoint2 !== null && duration > 0 && (
                                            <div
                                                className="mark-region-highlight"
                                                style={{
                                                    left: `${(Math.min(markPoint1, markPoint2) / duration) * 100}%`,
                                                    width: `${(Math.abs(markPoint2 - markPoint1) / duration) * 100}%`
                                                }}
                                            />
                                        )}

                                        {markPoint1 !== null && markPoint2 !== null && duration > 0 && (
                                            <div
                                                className="segment-input-popup"
                                                style={{
                                                    left: `${(Math.min(markPoint1, markPoint2) + Math.abs(markPoint2 - markPoint1) / 2) / duration * 100}%`
                                                }}
                                            >
                                                <div className="popup-title">{t.addSegment}</div>
                                                <div className="popup-times">
                                                    {formatTime(Math.min(markPoint1, markPoint2))} - {formatTime(Math.max(markPoint1, markPoint2))}
                                                </div>
                                                <input
                                                    autoFocus
                                                    type="text"
                                                    className="popup-input"
                                                    placeholder={t.segmentName}
                                                    value={segmentNameInput}
                                                    onChange={(e) => setSegmentNameInput(e.target.value)}
                                                    onKeyDown={(e) => {
                                                        e.stopPropagation();
                                                        if (e.key === 'Enter') {
                                                            e.preventDefault();
                                                            handleConfirmMark();
                                                        } else if (e.key === 'Escape') {
                                                            e.preventDefault();
                                                            handleCancelMark();
                                                        }
                                                    }}
                                                />
                                                <div className="popup-actions">
                                                    <button className="btn-small cancel" onClick={handleCancelMark}>
                                                        ✕
                                                    </button>
                                                    <button className="btn-small confirm" onClick={handleConfirmMark}>
                                                        ✓
                                                    </button>
                                                </div>
                                            </div>
                                        )}

                                        <input
                                            type="range"
                                            min={0}
                                            max={duration || 100}
                                            step={0.1}
                                            value={currentTime}
                                            onChange={(e) => {
                                                setIsSeeking(true);
                                                setCurrentTime(parseFloat(e.target.value));
                                            }}
                                            onMouseUp={(e) => {
                                                const target = e.target as HTMLInputElement;
                                                handleSeek(parseFloat(target.value));
                                                setIsSeeking(false);
                                                target.blur();
                                            }}
                                            onTouchEnd={(e) => {
                                                const target = e.target as HTMLInputElement;
                                                handleSeek(parseFloat(target.value));
                                                setIsSeeking(false);
                                                target.blur();
                                            }}
                                            onMouseMove={handleMouseMove}
                                            onMouseLeave={handleMouseLeave}
                                            onContextMenu={handleContextMenu}
                                            className="custom-range"
                                            style={{
                                                background: `linear-gradient(to right, var(--accent) 0%, var(--accent) ${(currentTime / (duration || 1)) * 100}%, var(--border-strong) ${(currentTime / (duration || 1)) * 100}%, var(--border-strong) 100%)`
                                            }}
                                        />
                                    </div>
                                    <span className="time-display total">{formatTime(duration)}</span>
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* 輸出資料夾選擇 */}
            <div className="input-group mt-4" style={{ marginBottom: "8px" }}>
                <label className="input-label">{t.mediaSplitOutputDir}</label>
                <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                    <input
                        type="text"
                        className="input"
                        value={outputDir}
                        placeholder={t.selectFolderPlaceholder}
                        readOnly
                        style={{ flex: 1 }}
                    />
                    <button
                        className="btn btn-secondary"
                        onClick={handleSelectOutputDir}
                        style={{ padding: "4px 12px", fontSize: "0.9rem" }}
                    >
                        📁 {t.selectFolder}
                    </button>
                </div>
            </div>

            {/* Segment Table Section */}
            <div className="segment-section mt-4 fade-in-up">
                <div className="section-header display-flex justify-between align-center mb-3">
                    <h3>📋 {t.segmentList}</h3>
                    <div style={{ display: "flex", gap: "8px" }}>
                        <button onClick={addSegment} className="btn btn-secondary btn-sm">
                            ➕ {t.addSegment}
                        </button>
                    </div>
                </div>

                <div className="table-container" style={{ marginTop: '12px' }}>
                    <table style={{
                        width: "100%",
                        borderCollapse: "collapse",
                        backgroundColor: "var(--bg-secondary, #1e1e1e)",
                        borderRadius: "8px",
                        overflow: "hidden"
                    }}>
                        <thead>
                            <tr style={{ backgroundColor: "var(--bg-tertiary, #2d2d2d)" }}>
                                <th style={{ padding: "12px", textAlign: "left", borderBottom: "1px solid var(--border, #444)", width: "300px" }}>{t.segmentName}</th>
                                <th style={{ padding: "12px", textAlign: "center", borderBottom: "1px solid var(--border, #444)", width: "160px" }}>{t.startTime}</th>
                                <th style={{ padding: "12px", textAlign: "center", borderBottom: "1px solid var(--border, #444)", width: "160px" }}>{t.endTime}</th>
                                <th style={{ padding: "12px", textAlign: "center", borderBottom: "1px solid var(--border, #444)", width: "80px" }}>{t.action}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {segments.map((segment) => (
                                <tr key={segment.id} style={{ borderBottom: "1px solid var(--border, #333)" }}>
                                    <td style={{ padding: "8px 4px 8px 12px", width: "300px" }}>
                                        <input
                                            type="text"
                                            value={segment.name}
                                            onChange={(e) => updateSegment(segment.id, "name", e.target.value)}
                                            placeholder={t.exampleName}
                                            style={{
                                                width: "100%",
                                                padding: "8px",
                                                border: "1px solid var(--border, #444)",
                                                borderRadius: "8px",
                                                backgroundColor: "var(--bg-primary, #121212)",
                                                color: segment.name ? "var(--text-primary, #fff)" : "#888"
                                            }}
                                        />
                                    </td>
                                    <td style={{ padding: "8px 4px", textAlign: "center", width: "160px" }}>
                                        <input
                                            type="text"
                                            value={segment.startTime}
                                            onChange={(e) => updateSegment(segment.id, "startTime", e.target.value)}
                                            onKeyDown={handleNumpadWorkaround}
                                            placeholder="00:00:00"
                                            style={{
                                                width: "140px",
                                                padding: "8px",
                                                border: "1px solid var(--border, #444)",
                                                borderRadius: "8px",
                                                backgroundColor: "var(--bg-primary, #121212)",
                                                color: segment.startTime ? "var(--text-primary, #fff)" : "#888",
                                                textAlign: "center",
                                                fontFamily: "monospace"
                                            }}
                                        />
                                    </td>
                                    <td style={{ padding: "8px 4px", textAlign: "center", width: "160px" }}>
                                        <input
                                            type="text"
                                            value={segment.endTime}
                                            onChange={(e) => updateSegment(segment.id, "endTime", e.target.value)}
                                            onKeyDown={handleNumpadWorkaround}
                                            placeholder="00:00:00"
                                            style={{
                                                width: "140px",
                                                padding: "8px",
                                                border: "1px solid var(--border, #444)",
                                                borderRadius: "8px",
                                                backgroundColor: "var(--bg-primary, #121212)",
                                                color: segment.endTime ? "var(--text-primary, #fff)" : "#888",
                                                textAlign: "center",
                                                fontFamily: "monospace"
                                            }}
                                        />
                                    </td>
                                    <td style={{ padding: "8px 12px", textAlign: "center", width: "80px" }}>
                                        <button
                                            onClick={() => deleteSegment(segment.id)}
                                            disabled={segments.length <= 1}
                                            style={{
                                                padding: "8px 16px",
                                                border: "none",
                                                borderRadius: "8px",
                                                backgroundColor: segments.length <= 1 ? "#555" : "#e74c3c",
                                                color: "#fff",
                                                cursor: segments.length <= 1 ? "not-allowed" : "pointer",
                                                fontWeight: "bold",
                                                fontSize: "14px",
                                                transition: "all 0.2s ease",
                                                margin: '0 auto',
                                                display: 'block'
                                            }}
                                            title={t.deleteSegment}
                                        >
                                            🗑️
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>

                <div className="action-footer mt-4" style={{ display: "flex", alignItems: "center", gap: "16px" }}>
                    <button
                        className="btn btn-primary btn-large"
                        onClick={runSplit}
                        disabled={loading}
                    >
                        {loading ? (
                            <span className="loading-spinner"></span>
                        ) : null}
                        <span>
                            {loading ? t.splitting : t.runSplit}
                        </span>
                    </button>
                </div>
            </div>

            {output && (
                <div className={`output-box mt-4 fade-in-up ${output.includes(t.error) ? "error" : ""}`}>
                    {output}
                </div>
            )}
        </div>
    );
}

const getFileName = (path: string) => path.split(/[/\\]/).pop() || path;
