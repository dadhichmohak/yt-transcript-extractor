import json
import os
import shutil
import subprocess
import sys
import tempfile


def fail(message):
    sys.stderr.write(message + "\n")
    sys.exit(1)


def main():
    if len(sys.argv) != 2:
        fail("usage: local_asr.py <video_id>")

    video_id = sys.argv[1].strip()
    if not video_id or len(video_id) != 11:
        fail("invalid video id")

    if shutil.which("yt-dlp") is None:
        fail("yt-dlp is not installed or not on PATH")

    model_size = os.environ.get("WHISPER_MODEL", "base")
    if model_size not in {"tiny", "base", "small", "medium", "large-v3"}:
        fail("WHISPER_MODEL must be one of tiny, base, small, medium, large-v3")

    workdir = tempfile.mkdtemp(prefix="yt-asr-")
    audio_path = os.path.join(workdir, "audio.%(ext)s")

    try:
        subprocess.run(
            [
                "yt-dlp",
                "--no-playlist",
                "--no-progress",
                "--no-warnings",
                "-f",
                "bestaudio/best",
                "-x",
                "--audio-format",
                "mp3",
                "-o",
                audio_path,
                "https://www.youtube.com/watch?v=" + video_id,
            ],
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
        )

        files = [name for name in os.listdir(workdir) if name.startswith("audio.")]
        if not files:
            fail("audio download produced no file")

        media_path = os.path.join(workdir, files[0])

        from faster_whisper import WhisperModel

        model = WhisperModel(model_size, device="cpu", compute_type="int8")
        segments, info = model.transcribe(media_path, beam_size=5, vad_filter=True)

        text = " ".join(segment.text.strip() for segment in segments).strip()
        text = " ".join(text.split())

        if not text:
            fail("transcription produced no text")

        payload = {
            "text": text,
            "language": getattr(info, "language", None) or "unknown",
            "durationSeconds": int(getattr(info, "duration", 0) or 0),
        }

        sys.stdout.write("TRANSCRIPT_JSON:" + json.dumps(payload, ensure_ascii=False) + "\n")
    except subprocess.CalledProcessError as error:
        stderr = (error.stderr or b"").decode("utf-8", "replace")
        fail("yt-dlp failed: " + stderr[-500:])
    except ImportError:
        fail("faster-whisper is not installed. Run: pip install faster-whisper")
    except Exception as error:
        fail("local asr failed: " + str(error)[-500:])
    finally:
        shutil.rmtree(workdir, ignore_errors=True)


if __name__ == "__main__":
    main()
