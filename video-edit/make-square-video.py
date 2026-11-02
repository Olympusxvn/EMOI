#!/usr/bin/env python3
"""Build the square (1080x1080) EMOI Attack Demo video for X/Twitter.

Style: near.com dark theme — black background, white text, NEAR green
(#00EC97) accent only. Red appears only on BLOCKED labels (same semantic
use as the frontend: rejected = red). All tx hashes below are real
testnet transactions from the frozen demo; rejected rows have no tx hash
by design — nothing was signed.
Slides are silent, 7 seconds each, 49 seconds total.
Font: DejaVu Sans (clean sans-serif available on this machine; the web
frontend loads real Inter — see frontend/index.html).
"""
import textwrap
from PIL import Image, ImageDraw, ImageFont

W = H = 1080
BG = (0, 0, 0)
CARD = (17, 17, 17)
BORDER = (38, 38, 38)
WHITE = (255, 255, 255)
GREY = (163, 163, 163)
LIGHT = (212, 212, 212)
GREEN = (0, 236, 151)
RED = (239, 68, 68)

FONT_DIR = "/usr/share/fonts/truetype/dejavu/"
def font(name, size):
    return ImageFont.truetype(FONT_DIR + name, size)

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
draw_slide(f"{S}01.png", "EMOI  ·  SAFE AGENT  ·  NEAR TESTNET",
           ["Give AI a wallet,", "but never the keys", "to everything."],
           ["On-chain policy. One limited key.", "Owner in control."],
           num="1 / 7")
draw_slide(f"{S}02.png", "THE POLICY",
           ["One agent.", "Strict limits."],
           [],
           card_lines=[("Agent ID  agent.emoi.testnet", True),
                       ("Max per tx  1 NEAR", False),
                       ("Daily limit  2 NEAR", False),
                       ("Whitelist  emoi01, emoi02", False),
                       ("Vault  policy.emoi.testnet", True)],
           num="2 / 7")
draw_slide(f"{S}03.png", "VALID PAYMENT",
           ["0.5 NEAR to a", "whitelisted vendor."],
           ["Pay the API / compute invoice", "from emoi01.testnet."],
           badge="SUCCESS", badge_color=GREEN,
           card_lines=[("Tx  AzefmP7m4VCyi7TUVinQQpZ7Z", True),
                       ("    Ysyv6j9H21419uceU67", True)],
           num="3 / 7")
draw_slide(f"{S}04.png", "ATTACK 1  ·  NOT WHITELISTED",
           ["Send 100 NEAR", "to attacker.near"],
           ["Not on the whitelist.", "Blocked before signing."],
           badge="BLOCKED BEFORE SIGNING", badge_color=RED,
           card_lines=[("Reason  RecipientNotWhitelisted", False),
                       ("No transaction signed.", False),
                       ("No tx hash.", False)],
           num="4 / 7")
draw_slide(f"{S}05.png", "ATTACK 2  ·  OVER THE LIMIT",
           ["1.5 NEAR to", "emoi01.testnet"],
           ["Whitelisted vendor, but over", "the 1 NEAR max per tx."],
           badge="BLOCKED BEFORE SIGNING", badge_color=RED,
           card_lines=[("Reason  ExceedsMaxPerTx", False),
                       ("No transaction signed.", False),
                       ("No tx hash.", False)],
           num="5 / 7")
draw_slide(f"{S}06.png", "OWNER CONTROL",
           ["Pause stops", "spending instantly."],
           ["A transfer attempted while", "paused is blocked", "before signing. No tx sent."],
           card_lines=[("Pause tx  9HnmP4Cuvk61MJ1pgVm6BuB", True),
                       ("          eA5rTspE6bFGzS58LyAaH", True),
                       ("Paused attempt  AgentPaused", False),
                       ("Resume tx  8PJUkRTj2Kxkziy4DZgBRD", True),
                       ("           YkGf6kqhTguUxcyCKMHaSC", True),
                       ("Revoke is terminal.", False)],
           num="6 / 7")
draw_slide(f"{S}07.png", "EMOI  ·  SAFE AGENT",
           ["Policy on-chain.", "Key limited.", "Owner in control."],
           ["agent.emoi.testnet", "policy.emoi.testnet"],
           num="7 / 7")
print("slides done")
