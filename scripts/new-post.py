#!/usr/bin/env python3
"""Create a dated Markdown post without overwriting an existing file."""

import argparse
from datetime import date, datetime
import json
from pathlib import Path
import re
import unicodedata
from zoneinfo import ZoneInfo


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("title", help="Post title, in quotes")
    parser.add_argument("--date", type=date.fromisoformat, help="Optional YYYY-MM-DD publication date")
    args = parser.parse_args()
    title = args.title.strip()
    ascii_title = unicodedata.normalize("NFKD", title).encode("ascii", "ignore").decode()
    slug = re.sub(r"[^a-z0-9]+", "-", ascii_title.lower()).strip("-")[:100].rstrip("-")
    if not slug:
        parser.error("Use a title containing at least one letter or number.")
    day = args.date or datetime.now(ZoneInfo("Europe/Stockholm")).date()
    root = Path(__file__).resolve().parent.parent
    posts = root / "_posts"
    posts.mkdir(exist_ok=True)
    path = posts / f"{day.isoformat()}-{slug}.md"
    text = f"---\ntitle: {json.dumps(title, ensure_ascii=False)}\n---\n\nWrite your post here.\n"
    try:
        with path.open("x", encoding="utf-8") as post:
            post.write(text)
    except FileExistsError:
        parser.error(f"Already exists: {path.relative_to(root)}; existing post was not changed.")
    print(f"Created {path.relative_to(root)}")
    print("Edit this file, then commit and push to publish it.")


if __name__ == "__main__":
    main()
