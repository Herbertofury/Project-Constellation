from gradio_client import Client, handle_file
from pathlib import Path
import shutil, subprocess, json, time, os, sys

ROOT = Path(__file__).resolve().parent
SRC = ROOT / "source.jpg"
OUT = ROOT / "output"
OUT.mkdir(exist_ok=True)

SPACE = "zerogpu-aoti/wan2-2-fp8da-aoti-faster"
NEG = (
    "low quality, blurry, distorted anatomy, deformed face, extra limbs, extra fingers, "
    "identity drift, face swap, fused bodies, melting, morphing, rubber sheet deformation, "
    "background shear, camera-only motion, static subjects, frozen pose"
)
PROMPT1 = (
    "Two adult fantasy women in a cozy gothic gamer bedroom. Preserve the exact identities, "
    "faces, teal and mint hair, curved horns, pointed ears, clothing, room, lighting, props and "
    "camera framing from the reference image. The teal-haired horned woman gently and playfully "
    "licks the mint-haired woman's cheek and face, with natural articulated head, neck, tongue, "
    "facial, eye, breathing, hair and clothing motion. The mint-haired woman reacts with a "
    "surprised playful expression and subtle natural movement. Realistic cheek contact and anatomy, "
    "stable identities, smooth cinematic motion, true synthesized subject motion. Fixed coherent "
    "camera, no camera-only pan or zoom, no morphing, no melting, no rubber-sheet warping."
)
PROMPT2 = (
    "Continue the exact same scene seamlessly. Preserve both adult fantasy women's identities, "
    "faces, horns, pointed ears, hair, clothing, room, lighting, props and camera framing. "
    "The teal-haired horned woman continues the gentle playful cheek-and-face licking interaction "
    "with natural articulated head, neck, tongue, facial, blinking, breathing, hair and fabric "
    "motion. The mint-haired woman continues reacting naturally and playfully. Stable anatomy, "
    "consistent cheek contact, smooth cinematic movement, true synthesized subject motion. Fixed "
    "coherent camera, no camera-only pan or zoom, no morphing, no melting, no rubber-sheet warping."
)

def extract_video(result):
    value = result[0] if isinstance(result, (list, tuple)) else result
    if isinstance(value, dict):
        for key in ("video", "path", "name"):
            if value.get(key):
                value = value[key]
                break
    if not isinstance(value, str):
        raise RuntimeError(f"Unexpected video result: {result!r}")
    return value

def call_native(client, image_path, prompt, seed, dst):
    print(f"Submitting native Wan2.2 clip: {image_path} seed={seed}", flush=True)
    last_error = None
    for attempt in range(1, 4):
        try:
            result = client.predict(
                handle_file(str(image_path)),
                prompt,
                6,
                NEG,
                5.0,
                3.0,
                1.0,
                seed,
                False,
                api_name="/generate_video",
            )
            print(f"Raw result attempt {attempt}: {result!r}", flush=True)
            video = extract_video(result)
            shutil.copy2(video, dst)
            if dst.stat().st_size < 10000:
                raise RuntimeError(f"Generated video too small: {dst.stat().st_size} bytes")
            return dst
        except Exception as exc:
            last_error = exc
            print(f"Attempt {attempt} failed: {type(exc).__name__}: {exc}", flush=True)
            if attempt < 3:
                time.sleep(20 * attempt)
    raise RuntimeError(f"Native Wan generation failed after retries: {last_error}")

print(f"Connecting to public ZeroGPU Space {SPACE}", flush=True)
client = Client(SPACE, verbose=True)
try:
    print("API:", client.view_api(return_format="dict"), flush=True)
except Exception as exc:
    print("API introspection warning:", exc, flush=True)

clip1 = call_native(client, SRC, PROMPT1, 731947, OUT / "clip1.mp4")

last = OUT / "clip1-last.jpg"
subprocess.run([
    "ffmpeg", "-y", "-sseof", "-0.10", "-i", str(clip1),
    "-frames:v", "1", "-q:v", "2", str(last)
], check=True)

clip2 = call_native(client, last, PROMPT2, 731948, OUT / "clip2.mp4")

concat = OUT / "concat.txt"
concat.write_text("file 'clip1.mp4'\nfile 'clip2.mp4'\n", encoding="utf-8")
final = OUT / "apd-10s-native-i2v.mp4"
subprocess.run([
    "ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(concat),
    "-c:v", "libx264", "-preset", "medium", "-crf", "17",
    "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(final)
], cwd=OUT, check=True)

probe = subprocess.check_output([
    "ffprobe", "-v", "error",
    "-show_entries", "format=duration,size:stream=codec_name,width,height,r_frame_rate,avg_frame_rate,nb_frames",
    "-of", "json", str(final)
], text=True)
(OUT / "ffprobe.json").write_text(probe, encoding="utf-8")
print("FINAL:", final, flush=True)
print(probe, flush=True)
