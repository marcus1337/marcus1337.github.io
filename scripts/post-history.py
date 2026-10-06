#!/usr/bin/env python3
"""Generate Jekyll data with committed, file-specific post history."""

import argparse
from datetime import date
import json
import os
from pathlib import Path
import re
import subprocess
import sys


SHA = re.compile(rb"[0-9a-f]{40}(?:[0-9a-f]{24})?\Z")
STATUS = re.compile(rb"[ACDMRTUXB][0-9]*\Z")
POST_NAME = re.compile(r"\d{4}-\d{2}-\d{2}-.+\.[^.]+\Z", re.DOTALL)


def git(root, *args):
    """Keep arbitrary paths literal and arbitrary output in bytes; never use a shell."""
    result = subprocess.run(
        ["git", "--no-pager", "--literal-pathspecs", "-c", "core.quotePath=true",
         *args],
        cwd=root, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False,
    )
    if result.returncode:
        raise RuntimeError(result.stderr.decode("utf-8", "replace").strip())
    return result.stdout


def text(raw):
    return raw.decode("utf-8", "replace")


def parse_history(raw):
    """Parse SHA/status/path NUL records without treating paths as lines."""
    fields = raw.split(b"\0")
    records = []
    current = None
    index = 0
    while index < len(fields):
        # Git adds a formatting LF before status fields, never inside path fields.
        field = fields[index].lstrip(b"\n")
        index += 1
        if not field:
            continue
        if SHA.fullmatch(field):
            current = {"sha": field.decode("ascii"), "files": []}
            records.append(current)
            continue
        if current is None or not STATUS.fullmatch(field):
            raise ValueError("Unexpected Git history record.")
        count = 2 if field[:1] in (b"R", b"C") else 1
        paths = fields[index:index + count]
        if len(paths) != count or any(not path for path in paths):
            raise ValueError("Incomplete Git history path record.")
        index += count
        # fsdecode preserves unusual filename bytes when passed back to Git.
        paths = [os.fsdecode(path) for path in paths]
        current["files"].append({
            "status": field.decode("ascii"),
            "old_path": paths[0],
            "path": paths[-1],
        })
    return records


def line_counts(raw):
    if not raw:
        return 0, 0
    # A blob diff can use the two-path NUL form, even without a filesystem rename.
    counts = raw.split(b"\t", 2)
    if len(counts) != 3:
        raise ValueError("Unexpected Git line-count record.")
    return tuple(None if value == b"-" else int(value) for value in counts[:2])


def patch_label(path):
    # Match Git's quoted-path convention for spaces, tabs, newlines and Unicode.
    if re.search(r'[\s"\\]', path) or not path.isascii():
        return json.dumps(path, ensure_ascii=True)
    return path


def relabel_blob_patch(patch, old_blob, new_blob, old_path, new_path):
    """Relabel only Git's header; never replace text inside a patch hunk."""
    old_label = patch_label("a/" + old_path)
    new_label = patch_label("b/" + new_path)
    replacements = {
        f"diff --git a/{old_blob} b/{new_blob}":
            f"diff --git {old_label} {new_label}",
        f"--- a/{old_blob}": f"--- {old_label}",
        f"+++ b/{new_blob}": f"+++ {new_label}",
        f"Binary files a/{old_blob} and b/{new_blob} differ":
            f"Binary files {old_label} and {new_label} differ",
    }
    lines = patch.splitlines(keepends=True)
    for index, line in enumerate(lines):
        if line.startswith("@@"):
            break
        bare = line.removesuffix("\n")
        if bare in replacements:
            lines[index] = replacements[bare] + ("\n" if line.endswith("\n") else "")
    return "".join(lines)


def file_change(root, sha, parent, record):
    old_path, path = record["old_path"], record["path"]
    options = ["--no-ext-diff", "--no-textconv", "--no-color",
               "--src-prefix=a/", "--dst-prefix=b/"]
    if record["status"].startswith(("R", "C")):
        # A tree diff over both names can leak an unrelated replacement at old_path.
        old_blob = text(git(root, "rev-parse", "--verify", f"{parent}:{old_path}")).strip()
        new_blob = text(git(root, "rev-parse", "--verify", f"{sha}:{path}")).strip()
        command = ["diff", old_blob, new_blob, *options]
        counts = git(root, *command, "--numstat", "-z", "--")
        patch = text(git(root, *command, "--patch", "--"))
        patch = relabel_blob_patch(patch, old_blob, new_blob, old_path, path)
    else:
        command = (["diff", parent, sha] if parent else
                   ["diff-tree", "--root", "--no-commit-id", "-r", sha])
        command += [*options, "--no-renames"]
        counts = git(root, *command, "--numstat", "-z", "--", path)
        patch = text(git(root, *command, "--patch", "--", path))
    additions, deletions = line_counts(counts)
    return {
        **record,
        "additions": additions,
        "deletions": deletions,
        "patch": patch,
        "parent": parent[:12] if parent else None,
    }


def post_files(root):
    """Mirror dated/front-matter post discovery, including nested post folders."""
    for path in sorted((root / "_posts").rglob("*")):
        if not path.is_file() or not POST_NAME.fullmatch(path.name):
            continue
        try:
            date.fromisoformat(path.name[:10])
        except ValueError:
            continue
        with path.open("rb") as source:
            first_line = source.readline().removeprefix(b"\xef\xbb\xbf")
        if first_line.rstrip(b"\r\n \t") == b"---":
            yield path.relative_to(root).as_posix()


def generate_history(root, repository):
    root = Path(root).resolve()
    if not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repository):
        raise ValueError("Repository must be a GitHub owner/repository name.")
    if git(root, "rev-parse", "--is-shallow-repository").strip() == b"true":
        raise ValueError("Full Git history is required. Use fetch-depth: 0 in Actions "
                         "or run git fetch --unshallow locally.")

    histories = {}
    metadata = {}
    for path in post_files(root):
        raw = git(root, "log", "--follow", "--find-renames", "--topo-order",
                  "--diff-merges=first-parent", "--no-show-signature", "--no-notes",
                  "--no-color", "--no-ext-diff", "--no-textconv", "--format=%H",
                  "--name-status", "-z", "--", path)
        commits = []
        seen = set()
        for record in parse_history(raw):
            sha = record["sha"]
            if not record["files"] or sha in seen:
                continue
            seen.add(sha)
            if sha not in metadata:
                # Only fixed-format fields precede the message: its content needs no delimiter.
                raw_meta = git(root, "show", "-s", "--no-show-signature", "--no-notes",
                               "--encoding=UTF-8", "--format=%P%x00%cI%x00%B", sha)
                parents, timestamp, message = raw_meta.split(b"\0", 2)
                message = text(message.removesuffix(b"\n"))
                metadata[sha] = {
                    "parents": parents.decode("ascii").split(),
                    "date": timestamp.decode("ascii"),
                    "message": message,
                    "subject": " ".join(message.split("\n\n", 1)[0].splitlines()).strip()
                               or "(No commit message)",
                }
            meta = metadata[sha]
            parent = meta["parents"][0] if meta["parents"] else None
            commits.append({
                "sha": sha,
                "short_sha": sha[:12],
                "date": meta["date"],
                "subject": meta["subject"],
                "message": meta["message"],
                "url": f"https://github.com/{repository}/commit/{sha}",
                "changes": [file_change(root, sha, parent, change)
                            for change in record["files"]],
            })
        histories[path] = commits
    return histories


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repository", default=os.environ.get("GITHUB_REPOSITORY"),
                        help="GitHub owner/repository (defaults to GITHUB_REPOSITORY)")
    args = parser.parse_args()
    if not args.repository:
        parser.error("Pass --repository owner/repository outside GitHub Actions.")
    root = Path(__file__).resolve().parent.parent
    try:
        histories = generate_history(root, args.repository)
        output = root / "_data" / "post_history.json"
        output.parent.mkdir(exist_ok=True)
        # ensure_ascii also safely encodes unusual filesystem bytes represented as surrogates.
        output.write_text(json.dumps(histories, indent=2, ensure_ascii=True) + "\n",
                          encoding="utf-8")
    except (RuntimeError, ValueError, OSError) as error:
        print(f"Post history generation failed: {error}", file=sys.stderr)
        return 1
    print(f"Generated history for {len(histories)} posts in {output.relative_to(root)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
