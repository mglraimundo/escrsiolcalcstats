#!/usr/bin/env python3
"""Stamp asset URLs in index.html with the current git short hash for cache busting."""

import re
import subprocess
from pathlib import Path

root = Path(__file__).parent.parent
index = root / "index.html"

hash_ = subprocess.check_output(["git", "rev-parse", "--short", "HEAD"], cwd=root).decode().strip()

html = index.read_text()
# Replace ?v=<old> or bare asset paths with ?v=<hash>
html = re.sub(r'(assets/(?:css|js)/[^"\']+?)(?:\?v=[^"\']*)?(")', rf'\1?v={hash_}\2', html)
index.write_text(html)

print(f"Stamped assets with ?v={hash_}")
