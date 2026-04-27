"""Fix cp1252 mojibake emojis across EPSA WEB source files.

Root cause: UTF-8 emoji bytes were decoded as Windows-1252, turning each byte
into a Windows-1252 character. Those characters were then saved as UTF-8,
producing a multi-character mojibake string.

This script computes the exact mojibake by encoding each emoji to UTF-8 then
decoding each byte through the cp1252 table (falling back to latin-1 for
undefined cp1252 bytes 0x81, 0x8D, 0x8F, 0x90, 0x9D which are silently dropped
because they have no cp1252 glyph and render as nothing).
"""
import os

BASE = os.path.dirname(os.path.abspath(__file__))

# cp1252 override table for the 0x80-0x9F range
# Bytes not listed map byte value == codepoint (latin-1 passthrough)
CP1252_EXTRA = {
    0x80: 0x20AC,  # €
    0x82: 0x201A,  # ‚
    0x83: 0x0192,  # ƒ
    0x84: 0x201E,  # „
    0x85: 0x2026,  # …
    0x86: 0x2020,  # †
    0x87: 0x2021,  # ‡
    0x88: 0x02C6,  # ˆ
    0x89: 0x2030,  # ‰
    0x8A: 0x0160,  # Š
    0x8B: 0x2039,  # ‹
    0x8C: 0x0152,  # Œ
    # 0x8D: undefined → dropped
    0x8E: 0x017D,  # Ž
    # 0x8F: undefined → dropped
    # 0x90: undefined → dropped
    0x91: 0x2018,  # '
    0x92: 0x2019,  # '
    0x93: 0x201C,  # "
    0x94: 0x201D,  # "
    0x95: 0x2022,  # •
    0x96: 0x2013,  # –
    0x97: 0x2014,  # —
    0x98: 0x02DC,  # ˜
    0x99: 0x2122,  # ™
    0x9A: 0x0161,  # š
    0x9B: 0x203A,  # ›
    0x9C: 0x0153,  # œ
    # 0x9D: undefined → dropped
    0x9E: 0x017E,  # ž
    0x9F: 0x0178,  # Ÿ
}
UNDEFINED_CP1252 = {0x81, 0x8D, 0x8F, 0x90, 0x9D}


def byte_to_cp1252_char(b):
    """Convert a single byte to its cp1252 character, or None if undefined."""
    if b in UNDEFINED_CP1252:
        return None  # Undefined in cp1252 — silently dropped
    if b in CP1252_EXTRA:
        return chr(CP1252_EXTRA[b])
    return chr(b)  # Latin-1 passthrough for 0x00-0x7F and 0xA0-0xFF


def emoji_mojibake(emoji_str):
    """Return the cp1252 mojibake string for a given emoji."""
    result = ""
    for byte in emoji_str.encode("utf-8"):
        ch = byte_to_cp1252_char(byte)
        if ch is not None:
            result += ch
    return result


# All emojis that appear in the codebase
EMOJIS = [
    "\U0001f393",       # 🎓 graduation cap
    "\U0001f3af",       # 🎯 dart/target
    "\U0001f5f3\ufe0f", # 🗳️ ballot box with check
    "\U0001f91d",       # 🤝 handshake
    "\U0001f4dd",       # 📝 memo
    "\U0001f39b\ufe0f", # 🎛️ control knobs
    "\U0001f4ca",       # 📊 bar chart
    "\U0001f4c8",       # 📈 chart increasing
    "\U0001f465",       # 👥 busts in silhouette
    "\U0001f4da",       # 📚 books
    "\U0001f3c6",       # 🏆 trophy
    "\u2705",           # ✅ check mark button
    "\u2014",           # — em dash
    "\u2192",           # → right arrow
    "\u2191",           # ↑ up arrow
    "\U0001f4e3",       # 📣 megaphone
    "\U0001f4e2",       # 📢 loudspeaker
    "\U0001f527",       # 🔧 wrench
    "\U0001f4b0",       # 💰 money bag
    "\U0001f4dc",       # 📜 scroll
    "\U0001f310",       # 🌐 globe
    "\U0001f465",       # 👥 (duplicate, harmless)
    "\U0001f511",       # 🔑 key
    "\U0001f512",       # 🔒 lock
    "\u2764\ufe0f",     # ❤️ red heart
    "\U0001f4f8",       # 📸 camera with flash
    "\U0001f44b",       # 👋 waving hand
]

# Build replacement map: mojibake → correct emoji
REPLACEMENTS = {}
for emoji in EMOJIS:
    bad = emoji_mojibake(emoji)
    if bad and bad != emoji:
        REPLACEMENTS[bad] = emoji

print(f"[Info] Built {len(REPLACEMENTS)} replacement entries.")
for bad, good in sorted(REPLACEMENTS.items(), key=lambda x: len(x[0]), reverse=True):
    print(f"  {repr(bad)} -> {good.encode('ascii', errors='namereplace').decode('ascii')}")


FILES = [
    "frontend/login.html",
    "frontend/dashboard.html",
    "frontend/clubs.html",
    "frontend/admin/login.html",
    "frontend/admin/dashboard.html",
    "frontend/js/admin.js",
    "frontend/js/auth.js",
    "frontend/js/api.js",
    "backend/models.py",
    "backend/auth.py",
]

total_fixed = 0
for rel in FILES:
    path = os.path.join(BASE, rel.replace("/", os.sep))
    if not os.path.exists(path):
        print(f"SKIP (not found): {rel}")
        continue
    with open(path, "r", encoding="utf-8") as f:
        content = f.read()
    original = content
    # Apply longest replacements first to avoid partial matches
    for bad in sorted(REPLACEMENTS, key=len, reverse=True):
        content = content.replace(bad, REPLACEMENTS[bad])
    if content != original:
        with open(path, "w", encoding="utf-8") as f:
            f.write(content)
        n = sum(1 for bad in REPLACEMENTS if bad in original)
        print(f"FIXED ({n} unique patterns): {rel}")
        total_fixed += 1
    else:
        print(f"Clean (no changes):         {rel}")

print(f"\nDone. {total_fixed} file(s) updated.")
