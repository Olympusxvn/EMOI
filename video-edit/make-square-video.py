#!/usr/bin/env python3
"""Build the square (1080x1080) EMOI demo video for X/Twitter.

Style: nearhackathon.com — cream paper background, dark olive-ink text,
blue accent (section labels, rules, badges). Red appears only on BLOCKED
labels (rejected = red, same semantic use as the frontend). Section
kickers mimic the site ("00 / THE PROBLEM"); slide numbers read "01 / 07".
All tx hashes below are real testnet transactions; rejected rows have no
tx hash by design — nothing was signed.
Slides are silent, 7 seconds each, 49 seconds total. Ratio always 1:1.
Fonts: Arial Bold (site display face) + Consolas/DejaVu mono (site uses
IBM Plex Mono for labels; closest local equivalents).
"""
import os
import textwrap
from PIL import Image, ImageDraw, ImageFont

W = H = 1080
BG = (231, 223, 202)
CARD = (220, 210, 186)
BORDER = (189, 177, 153)
WHITE = (22, 26, 21)
GREY = (74, 82, 65)
LIGHT = (50, 46, 37)
GREEN = (0, 95, 176)
RED = (176, 42, 42)

WIN_FONTS = {"DejaVuSans-Bold.ttf": "arialbd.ttf", "DejaVuSans.ttf": "arial.ttf", "DejaVuSansMono.ttf": "consola.ttf"}
def _font_path(name):
    candidates = ["/usr/share/fonts/truetype/dejavu/" + name,
                    "/usr/share/fonts/TTF/" + name]
    if name in WIN_FONTS:
        candidates.append(os.path.join(os.environ.get("SystemRoot", r"C:\Windows"), "Fonts", WIN_FONTS[name]))
    for p in candidates:
        if os.path.exists(p):
            return p
    raise FileNotFoundError(name)
def font(name, size):
    return ImageFont.truetype(_font_path(name), size)

F_KICKER = font("DejaVuSans-Bold.ttf", 28)
F_TITLE = font("DejaVuSans-Bold.ttf", 72)
F_BODY = font("DejaVuSans.ttf", 34)
F_SMALL = font("DejaVuSans.ttf", 28)
F_MONO = font("DejaVuSansMono.ttf", 26)
F_MONO_SM = font("DejaVuSansMono.ttf", 22)

def draw_slide(path, kicker, title_lines, body_lines, card_lines=None,
                badge=None, badge_color=GREEN, num=""):
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)
    # Top kicker + green rule
    d.text((80, 80), kicker, font=F_KICKER, fill=GREEN)
    d.rectangle([80, 130, 200, 136], fill=GREEN)
    y = 180
    for line in title_lines:
        d.text((80, y), line, font=F_TITLE, fill=WHITE)
        y += 88
    y += 20
    for line in body_lines:
        for wrapped in textwrap.wrap(line, width=34):
            d.text((80, y), wrapped, font=F_BODY, fill=LIGHT)
            y += 48
        y += 8
    if badge:
        bw = int(d.textlength(badge, font=F_KICKER))
        d.rounded_rectangle([80, y + 10, 80 + 40 + bw, y + 66],
                            radius=28, outline=badge_color, width=3)
        d.text((100, y + 22), badge, font=F_KICKER, fill=badge_color)
        y += 100
    if card_lines:
        # Card height from content
        ch = 40 + 44 * len(card_lines)
        d.rounded_rectangle([80, y + 10, 1000, y + 10 + ch], radius=24,
                            fill=CARD, outline=BORDER, width=2)
        cy = y + 34
        for line, mono in card_lines:
            d.text((110, cy), line, font=F_MONO if mono else F_BODY,
                   fill=WHITE if mono else LIGHT)
            cy += 44
    d.text((80, 1000), num, font=F_SMALL, fill=GREY)
    d.text((80, 1000), "", font=F_SMALL, fill=GREY)
    img.save(path)

S = "square"
draw_slide(f"{S}01.png", "00 / THE PROBLEM",
           ["Your AI assistant", "needs to pay", "for things."],
           ["But one bad instruction", "could drain your wallet."],
           num="01 / 07")
draw_slide(f"{S}02.png", "01 / ONE MOMENT",
           ["Pay the 0.5 NEAR", "API invoice."],
           [],
           card_lines=[("Agent  judgetest01.emoi.testnet", True),
                       ("Max per tx  1 NEAR", False),
                       ("Daily limit  2 NEAR", False),
                       ("Whitelist  emoi01, emoi02", False)],
           num="02 / 07")
draw_slide(f"{S}03.png", "02 / RECEIPT",
           ["Paid. 0.5 NEAR", "to emoi01."],
           ["Settled on NEAR testnet."],
           badge="SUCCESS", badge_color=GREEN,
           card_lines=[("Tx  7QVSEX2jgLbHXJvA9ertXWJfC", True),
                       ("    7vgPNZ5dc6QsHrd7Dt1", True)],
           num="03 / 07")
draw_slide(f"{S}04.png", "03 / THE ATTACK",
           ["Send 100 NEAR", "to attacker.near"],
           ["Not on the whitelist.", "Blocked before signing."],
           badge="BLOCKED BEFORE SIGNING", badge_color=RED,
           card_lines=[("Reason  RecipientNotWhitelisted", False),
                       ("No transaction signed.", False),
                       ("No tx hash.", False)],
           num="04 / 07")
draw_slide(f"{S}05.png", "04 / WHY NEAR",
           ["Limits live in", "a NEAR contract."],
           ["The agent key calls", "one method only.",
            "No UI can bypass it."],
           card_lines=[("Contract  policy.emoi.testnet", True)],
           num="05 / 07")
draw_slide(f"{S}06.png", "05 / OWNER CONTROL",
           ["Pause stops", "spending instantly."],
           ["A transfer attempted while", "paused is blocked", "before signing. No tx sent."],
           card_lines=[("Pause tx  9HnmP4Cuvk61MJ1pgVm6BuB", True),
                       ("          eA5rTspE6bFGzS58LyAaH", True),
                       ("Paused attempt  AgentPaused", False),
                       ("Resume tx  8PJUkRTj2Kxkziy4DZgBRD", True),
                       ("           YkGf6kqhTguUxcyCKMHaSC", True),
                       ("Revoke is terminal.", False)],
           num="06 / 07")
draw_slide(f"{S}07.png", "06 / YOUR TURN",
           ["What limit would", "you set?"],
           ["Demo + code:",
            "github.com/Olympusxvn/EMOI"],
           num="07 / 07")
print("slides done")
