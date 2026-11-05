#!/usr/bin/env python3
"""Assemble EMOI-demo-square-49s.mp4 from slides/square0{1..7}.png.

7 slides x 7 seconds each at 30 fps = 49 seconds, 1080x1080 (1:1),
libx264 + yuv420p for X/Twitter compatibility. macro_block_size=8 keeps
the 1080 width intact (1080 is divisible by 8, not by 16).
Requires: pip install imageio imageio-ffmpeg
Usage: python assemble-video.py  (run from video-edit/)
"""
import os
import imageio.v2 as imageio

HERE = os.path.dirname(os.path.abspath(__file__))
FPS = 30
SECONDS_PER_SLIDE = 7
OUT = os.path.join(HERE, "EMOI-demo-square-49s.mp4")

frames = []
for i in range(1, 8):
    img = imageio.imread(os.path.join(HERE, "slides", f"square0{i}.png"))
    assert img.shape[0] == 1080 and img.shape[1] == 1080, f"slide {i} is not 1080x1080"
    frames.extend([img] * (FPS * SECONDS_PER_SLIDE))

w = imageio.get_writer(OUT, fps=FPS, codec="libx264", quality=8,
                       macro_block_size=8, ffmpeg_params=["-pix_fmt", "yuv420p"])
for f in frames:
    w.append_data(f)
w.close()
print(f"wrote {OUT}: {len(frames) / FPS:.0f}s, {os.path.getsize(OUT)} bytes")
