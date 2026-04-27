"""Inspect emoji bytes in HTML files to diagnose the encoding issue."""
import os

def inspect_file(path, keyword="auth-feature-icon"):
    with open(path, "rb") as f:
        raw = f.read()
    text = raw.decode("utf-8", errors="replace")
    lines = text.split("\n")
    print(f"\n=== {path} ===")
    for i, line in enumerate(lines, start=1):
        if keyword in line or "feature-icon" in line or "\ufffd" in line:
            # Show surrounding emoji bytes
            start = max(0, lines[i-1].find("icon") - 5 if i > 0 else 0)
            print(f"  L{i}: {repr(line[:200])}")
            # Also find raw bytes for this line
            enc_line = line.encode("utf-8", errors="replace")
            for j in range(len(enc_line) - 3):
                b = enc_line[j:j+4]
                if b[0] > 0xC0:
                    print(f"    bytes at {j}: {b.hex()}")
            break

def check_emoji_content(path, search="feature-icon"):
    with open(path, encoding="utf-8") as f:
        lines = f.readlines()
    for i, line in enumerate(lines, 1):
        if search in line:
            # Get the emoji chars
            chars = [f"U+{ord(c):04X}" for c in line if ord(c) > 127]
            print(f"  L{i}: chars={chars[:10]}")
            print(f"  L{i}: text={line.strip()[:120]}")
            break

files = [
    "frontend/login.html",
    "frontend/admin/login.html",
    "frontend/dashboard.html",
    "frontend/admin/dashboard.html",
]

print("=== Unicode codepoints in emoji areas ===")
for f in files:
    if os.path.exists(f):
        check_emoji_content(f)
