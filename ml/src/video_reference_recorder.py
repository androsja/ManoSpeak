"""Record one timed local sign-reference video from the Mac camera."""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
from pathlib import Path
import re
import time

import cv2
import numpy as np

COUNTDOWN_SECONDS = 3.0
FINISHED_MESSAGE_SECONDS = 0.65
MIN_DURATION_SECONDS = 0.5
MAX_DURATION_SECONDS = 15.0


def validate_recording_request(gloss: str, duration_seconds: float) -> tuple[str, float]:
    normalized_gloss = " ".join(gloss.upper().split())
    if not normalized_gloss:
        raise ValueError("The sign name cannot be empty.")
    if not MIN_DURATION_SECONDS <= duration_seconds <= MAX_DURATION_SECONDS:
        raise ValueError(
            f"The duration must be between {MIN_DURATION_SECONDS:.1f} and "
            f"{MAX_DURATION_SECONDS:.1f} seconds."
        )
    return normalized_gloss, duration_seconds


def safe_filename(value: str) -> str:
    ascii_like = re.sub(r"[^A-Z0-9]+", "_", value.upper()).strip("_")
    return ascii_like or "SIGN"


def draw_status(frame: np.ndarray, title: str, detail: str) -> np.ndarray:
    preview = frame.copy()
    height, width = preview.shape[:2]
    panel_height = min(180, max(125, height // 4))
    overlay = preview.copy()
    cv2.rectangle(overlay, (0, 0), (width, panel_height), (7, 17, 31), -1)
    cv2.addWeighted(overlay, 0.90, preview, 0.10, 0.0, preview)
    title_scale = max(0.8, min(1.45, width / 900.0))
    detail_scale = max(0.5, min(0.85, width / 1450.0))
    cv2.putText(
        preview,
        title,
        (32, 62),
        cv2.FONT_HERSHEY_SIMPLEX,
        title_scale,
        (255, 255, 255),
        3,
        cv2.LINE_AA,
    )
    cv2.putText(
        preview,
        detail,
        (32, 112),
        cv2.FONT_HERSHEY_SIMPLEX,
        detail_scale,
        (22, 217, 209),
        2,
        cv2.LINE_AA,
    )
    return preview


def create_video_writer(path: Path, fps: float, frame_size: tuple[int, int]) -> cv2.VideoWriter:
    for codec in ("avc1", "mp4v"):
        writer = cv2.VideoWriter(
            str(path),
            cv2.VideoWriter_fourcc(*codec),
            fps,
            frame_size,
        )
        if writer.isOpened():
            return writer
        writer.release()
    raise RuntimeError("The MP4 video encoder could not be opened.")


def record_video(
    camera_index: int,
    gloss: str,
    duration_seconds: float,
    output_dir: Path,
) -> Path:
    normalized_gloss, duration_seconds = validate_recording_request(gloss, duration_seconds)
    camera = cv2.VideoCapture(camera_index, cv2.CAP_AVFOUNDATION)
    if not camera.isOpened():
        raise RuntimeError("The Mac camera could not be opened. Check camera permission.")
    camera.set(cv2.CAP_PROP_FRAME_WIDTH, 1280)
    camera.set(cv2.CAP_PROP_FRAME_HEIGHT, 720)
    camera.set(cv2.CAP_PROP_FPS, 30)

    ok, first_frame = camera.read()
    if not ok:
        camera.release()
        raise RuntimeError("The Mac camera did not return an image.")
    height, width = first_frame.shape[:2]
    measured_fps = camera.get(cv2.CAP_PROP_FPS)
    output_fps = measured_fps if 12.0 <= measured_fps <= 60.0 else 30.0
    output_dir.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    output_path = output_dir / f"{safe_filename(normalized_gloss)}_{timestamp}.mp4"
    writer = create_video_writer(output_path, output_fps, (width, height))

    # OpenCV's macOS window backend does not consistently decode accented
    # UTF-8 titles. Keep this native window title ASCII-only.
    window_name = "VOZUAL - Grabacion de sena"
    cv2.namedWindow(window_name, cv2.WINDOW_NORMAL)
    cv2.resizeWindow(window_name, min(width, 1280), min(height, 720))
    countdown_started_at = time.perf_counter()
    recording_started_at: float | None = None
    finished_at: float | None = None
    canceled = False
    pending_frame = first_frame

    try:
        while True:
            frame = pending_frame
            pending_frame = None
            if frame is None:
                ok, frame = camera.read()
                if not ok:
                    raise RuntimeError("The camera stopped returning images.")
            now = time.perf_counter()
            mirrored = cv2.flip(frame, 1)

            if recording_started_at is None:
                elapsed = now - countdown_started_at
                remaining = max(1, int(np.ceil(COUNTDOWN_SECONDS - elapsed)))
                title = f"PREPARATE: {remaining}"
                detail = f"Al llegar a cero realiza {normalized_gloss}"
                if elapsed >= COUNTDOWN_SECONDS:
                    recording_started_at = now
                    title = "GRABANDO"
                    detail = f"Realiza {normalized_gloss} durante {duration_seconds:.1f} s"
            elif finished_at is None:
                elapsed = now - recording_started_at
                if elapsed < duration_seconds:
                    writer.write(mirrored)
                    remaining_time = max(0.0, duration_seconds - elapsed)
                    title = "GRABANDO"
                    detail = f"{normalized_gloss} — faltan {remaining_time:.1f} s"
                else:
                    finished_at = now
                    title = "GRABACION TERMINADA"
                    detail = "El video quedo listo para analizar"
            else:
                title = "GRABACION TERMINADA"
                detail = "El video quedo listo para analizar"
                if now - finished_at >= FINISHED_MESSAGE_SECONDS:
                    break

            cv2.imshow(window_name, draw_status(mirrored, title, detail))
            key = cv2.waitKey(1) & 0xFF
            if key in (ord("q"), 27):
                canceled = True
                break
            # The red macOS close button does not emit a keyboard event.
            # WND_PROP_VISIBLE is the only reliable way to treat it as cancel.
            try:
                window_visible = cv2.getWindowProperty(
                    window_name, cv2.WND_PROP_VISIBLE
                )
            except cv2.error:
                window_visible = 0
            if window_visible < 1:
                canceled = True
                break
    finally:
        writer.release()
        camera.release()
        cv2.destroyAllWindows()

    if canceled:
        output_path.unlink(missing_ok=True)
        raise RuntimeError("La grabación fue cancelada.")
    if not output_path.is_file() or output_path.stat().st_size == 0:
        raise RuntimeError("The recording did not produce a valid video file.")
    return output_path


def main() -> None:
    parser = argparse.ArgumentParser(description="Record one timed sign-reference MP4.")
    parser.add_argument("--gloss", required=True)
    parser.add_argument("--duration-seconds", required=True, type=float)
    parser.add_argument("--camera", type=int, default=0)
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path("tmp/creator_references/recorded_videos"),
    )
    args = parser.parse_args()
    path = record_video(args.camera, args.gloss, args.duration_seconds, args.output_dir)
    print(f"VIDEO={path}")


if __name__ == "__main__":
    main()
