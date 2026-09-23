from gradio_client import Client, handle_file
from pathlib import Path
import shutil, subprocess, json, os, sys, time

ROOT = Path(__file__).resolve().parent
SRC = ROOT / "source.jpg"
OUT = ROOT / "output"
OUT.mkdir(exist_ok=True)

SPACE = "yuknassty/wan2-2-image-to-video"
PROMPT1 = (
    "Two adult fantasy women in a cozy gothic gamer bedroom. Preserve the exact identities, "
    "faces, teal and mint hair, curved horns, pointed ears, clothing, room, lighting, props and "
    "camera framing from the reference image. The teal-haired horned woman gently and playfully "
    "licks the mint-haired woman's cheek and face, with natural head, neck, tongue, facial, eye, "
    "breathing, hair and clothing motion. The mint-haired woman reacts with a surprised playful "
    "expression and subtle natural movement. Realistic contact and anatomy, stable identities, "
    "smooth cinematic motion, true synthesized motion, no camera-only pan or zoom, no morphing, "
    "no melting, no rubber-sheet warping."
)
PROMPT2 = (
    "Continue this exact scene seamlessly from the reference frame. Preserve both adult fantasy "
    "women's identities, faces, horns, ears, hair, clothing, room, lighting, props and camera. "
    "The teal-haired woman continues the gentle playful cheek-and-face licking interaction with "
    "natural articulated head, neck, tongue, facial, blinking, breathing, hair and fabric motion; "
    "the mint-haired woman continues reacting naturally and playfully. Stable anatomy and contact, "
    "smooth cinematic movement, true synthesized motion, no camera-only pan or zoom, no morphing, "
    "no melting, no rubber-sheet warping."
)

def run_clip(client, image_path, prompt, seed, out_path):
    print(f"Submitting clip from {image_path} seed={seed}", flush=True)
    result = client.predict(
        handle_file(str(image_path)),
        prompt,
        5.0,
        4,
        seed,
        False,
        api_name="/generate_video",
    )
    print("Result:", result, flush=True)
    video = result[0] if isinstance(result, (list, tuple)) else result
    if isinstance(video, dict):
        video = video.get("video") or video.get("path") or video.get("name")
    if not video:
        raise RuntimeError(f"No video path returned: {result!r}")
    shutil.copy2(video, out_path)
    return out_path

client = Client(SPACE, verbose=True)
try:
    print(client.view_api(return_format="dict"), flush=True)
except Exception as e:
    print("view_api warning:", e, flush=True)

clip1 = run_clip(client, SRC, PROMPT1, 731947, OUT / "clip1.mp4")

last = OUT / "clip1-last.jpg"
subprocess.run([
    "ffmpeg", "-y", "-sseof", "-0.08", "-i", str(clip1),
    "-frames:v", "1", "-q:v", "2", str(last)
], check=True)

clip2 = run_clip(client, last, PROMPT2, 731948, OUT / "clip2.mp4")

concat_file = OUT / "concat.txt"
concat_file.write_text("file 'clip1.mp4'\nfile 'clip2.mp4'\n", encoding="utf-8")

final = OUT / "apd-10s-native-i2v.mp4"
subprocess.run([
    "ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(concat_file),
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart",
    "-r", "16", str(final)
], cwd=OUT, check=True)

probe = subprocess.check_output([
    "ffprobe", "-v", "error", "-show_entries", "format=duration:stream=codec_name,width,height,r_frame_rate",
    "-of", "json", str(final)
], text=True)
(OUT / "ffprobe.json").write_text(probe, encoding="utf-8")
print("FINAL", final, flush=True)
print(probe, flush=True)
