"""Exercise post history against real Git repositories and unusual file names."""

from __future__ import annotations

import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "post-history.py"
FRONT_MATTER = b"---\ntitle: Example\n---\n"


class PostHistoryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        spec = importlib.util.spec_from_file_location("post_history", SCRIPT)
        assert spec is not None and spec.loader is not None
        cls.module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cls.module)

    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name) / "site"
        self.root.mkdir()
        self.sequence = 0
        self.git("init", "--initial-branch=main")
        self.git("config", "user.name", "History Test")
        self.git("config", "user.email", "history@example.invalid")
        self.git("config", "commit.gpgsign", "false")
        self.git("config", "core.autocrlf", "false")

    def git(self, *arguments, check=True):
        result = subprocess.run(
            ["git", "-C", str(self.root), *arguments],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
        )
        if check and result.returncode:
            self.fail(
                f"git {arguments!r} failed:\n"
                + result.stderr.decode("utf-8", errors="replace")
            )
        return result

    def write(self, name, content):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        raw = content if isinstance(content, bytes) else content.encode("utf-8")
        if name.startswith("_posts/"):
            raw = FRONT_MATTER + raw
        path.write_bytes(raw)

    def commit(self, message):
        self.sequence += 1
        self.git("add", "--all")
        env = dict(os.environ)
        timestamp = f"2026-10-06T12:00:{self.sequence:02d}+00:00"
        env.update(GIT_AUTHOR_DATE=timestamp, GIT_COMMITTER_DATE=timestamp)
        result = subprocess.run(
            ["git", "-C", str(self.root), "commit", "--quiet", "-m", message],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            env=env,
            check=False,
        )
        if result.returncode:
            self.fail(result.stderr.decode("utf-8", errors="replace"))
        return self.git("rev-parse", "HEAD").stdout.decode().strip()

    def history(self):
        return self.module.generate_history(self.root, "example/blog")

    def single_change(self, entry):
        self.assertEqual(len(entry["changes"]), 1)
        return entry["changes"][0]

    def assert_metadata(self, entry, sha, subject):
        self.assertEqual(entry["sha"], sha)
        self.assertTrue(sha.startswith(entry["short_sha"]))
        self.assertGreaterEqual(len(entry["short_sha"]), 7)
        self.assertTrue(entry["date"].startswith("2026-10-06"))
        self.assertEqual(entry["subject"], subject)
        self.assertEqual(entry["url"], f"https://github.com/example/blog/commit/{sha}")

    def test_only_current_posts_changes_and_commits_are_included(self):
        post = "_posts/2026-10-06-example.md"
        self.write(post, "first\n")
        self.write("private.txt", "EXTERNAL_ROOT_SECRET\n")
        first = self.commit("Create post and another file")
        self.write(post, "first\nsecond\n")
        self.write("private.txt", "EXTERNAL_EDIT_SECRET\n")
        second = self.commit("Edit post and another file")
        self.write("private.txt", "UNRELATED_ONLY_SECRET\n")
        unrelated = self.commit("Only edit another file")

        entries = self.history()[post]
        self.assertEqual([entry["sha"] for entry in entries], [second, first])
        self.assertNotIn(unrelated, [entry["sha"] for entry in entries])
        for entry, sha, subject in zip(
            entries,
            [second, first],
            ["Edit post and another file", "Create post and another file"],
        ):
            self.assert_metadata(entry, sha, subject)
            change = self.single_change(entry)
            self.assertEqual(change["path"], post)
            self.assertEqual((change["additions"], change["deletions"]),
                             (4 if sha == first else 1, 0))
            self.assertNotIn("SECRET", change["patch"])
            self.assertNotIn("private.txt", change["patch"])
        self.assertIn("+first", self.single_change(entries[-1])["patch"])
        self.assertIn("+second", self.single_change(entries[0])["patch"])

    def test_rename_is_followed_and_a_pure_rename_has_zero_line_changes(self):
        old = "_posts/2026-10-06-old.md"
        new = "_posts/2026-10-06-new.md"
        self.write(old, "alpha\nbeta\ngamma\n")
        first = self.commit("Original post")
        self.git("mv", "--", old, new)
        renamed = self.commit("Rename post")
        self.write(new, "alpha\nrevised beta\ngamma\n")
        edited = self.commit("Revise renamed post")

        result = self.history()
        self.assertNotIn(old, result)
        entries = result[new]
        self.assertEqual([entry["sha"] for entry in entries], [edited, renamed, first])
        rename_change = self.single_change(entries[1])
        self.assertTrue(rename_change["status"].startswith("R"))
        self.assertEqual(rename_change["old_path"], old)
        self.assertEqual(rename_change["path"], new)
        self.assertEqual((rename_change["additions"], rename_change["deletions"]), (0, 0))
        self.assertEqual(self.single_change(entries[-1])["path"], old)
        edit_change = self.single_change(entries[0])
        self.assertEqual((edit_change["additions"], edit_change["deletions"]), (1, 1))
        self.assertIn("+revised beta", edit_change["patch"])

    def test_copied_history_compares_the_two_post_blobs_only(self):
        old = "_posts/2026-10-06-original.md"
        new = "_posts/2026-10-06-moved.md"
        content = "".join(f"paragraph number {index:02d}\n" for index in range(12))
        self.write(old, content)
        first = self.commit("Write original")
        self.git("mv", "--", old, new)
        self.write(new, content.replace("paragraph number 05", "paragraph edited 05"))
        self.write(old, "OLD_PATH_RECREATED_SECRET\n")
        moved = self.commit("Move and edit post; reuse its old file name")

        entries = self.history()[new]
        self.assertEqual([entry["sha"] for entry in entries], [moved, first])
        change = self.single_change(entries[0])
        self.assertTrue(change["status"].startswith(("C", "R")))
        self.assertEqual(change["old_path"], old)
        self.assertEqual(change["path"], new)
        self.assertEqual((change["additions"], change["deletions"]), (1, 1))
        self.assertIn("-paragraph number 05", change["patch"])
        self.assertIn("+paragraph edited 05", change["patch"])
        self.assertNotIn("OLD_PATH_RECREATED_SECRET", change["patch"])

    def test_literal_paths_support_unicode_tabs_newlines_and_nested_markdown(self):
        post = "_posts/a folder\tλ\n[folder]/2026-10-06-[draft]λ.markdown"
        decoy = "_posts/a folder\tλ\nf/2026-10-06-dλ.markdown"
        self.write(post, "hej världen\n")
        self.write(decoy, "other post\n")
        first = self.commit("Create posts with unusual names")
        self.write(decoy, "PATHSPEC_DECOY_SECRET\n")
        self.commit("Only edit the other post")
        self.write("_posts/a folder/notes.txt", "not a Markdown post\n")

        result = self.history()
        self.assertIn(post, result)
        self.assertIn(decoy, result)
        self.assertNotIn("_posts/a folder/notes.txt", result)
        entries = result[post]
        self.assertEqual([entry["sha"] for entry in entries], [first])
        change = self.single_change(entries[0])
        self.assertEqual(change["path"], post)
        self.assertIn("+hej världen", change["patch"])
        self.assertNotIn("PATHSPEC_DECOY_SECRET", change["patch"])

    def test_multiline_commit_messages_do_not_corrupt_diff_parsing(self):
        post = "_posts/2026-10-06-message.md"
        self.write(post, "actual post content\n")
        message = (
            'Subject with <details> & "quotes" and å\n\n'
            "Body with fake parsing markers: \x1e\x1f\n"
            "commit deadbeef\n"
            "diff --git a/unrelated.txt b/unrelated.txt\n"
            "@@ -1 +1 @@\n"
            "+MESSAGE_ONLY_SECRET\n\n"
            "Final body paragraph."
        )
        sha = self.commit(message)

        entry = self.history()[post][0]
        self.assert_metadata(entry, sha, message.splitlines()[0])
        self.assertEqual(entry["message"].rstrip("\n"), message)
        change = self.single_change(entry)
        self.assertIn("+actual post content", change["patch"])
        self.assertNotIn("MESSAGE_ONLY_SECRET", change["patch"])
        self.assertNotIn("unrelated.txt", change["patch"])

    def test_binary_post_diff_has_unknown_line_counts(self):
        post = "_posts/2026-10-06-binary.md"
        self.write(post, b"\x00previous\n")
        first = self.commit("Create binary content")
        self.write(post, b"\x00current\n")
        second = self.commit("Change binary content")

        entries = self.history()[post]
        self.assertEqual([entry["sha"] for entry in entries], [second, first])
        for entry in entries:
            change = self.single_change(entry)
            self.assertIsNone(change["additions"])
            self.assertIsNone(change["deletions"])
            self.assertIn("Binary files", change["patch"])

    def test_conflict_merge_keeps_both_branches_and_shows_first_parent_diff(self):
        post = "_posts/2026-10-06-merge.md"
        self.write(post, "base\n")
        base = self.commit("Start post")
        self.git("checkout", "-b", "feature")
        self.write(post, "feature\n")
        self.write("other.txt", "MERGED_OTHER_FILE_SECRET\n")
        feature = self.commit("Feature branch edit")
        self.git("checkout", "main")
        self.write(post, "main\n")
        main = self.commit("Main branch edit")
        conflict = self.git("merge", "--no-ff", "--no-commit", "feature", check=False)
        self.assertEqual(conflict.returncode, 1)
        self.write(post, "resolved\n")
        merged = self.commit("Resolve post conflict")

        entries = self.history()[post]
        self.assertEqual(entries[0]["sha"], merged)
        self.assertEqual({entry["sha"] for entry in entries}, {merged, main, feature, base})
        change = self.single_change(entries[0])
        self.assertTrue(main.startswith(change["parent"]))
        self.assertEqual((change["additions"], change["deletions"]), (1, 1))
        self.assertIn("-main", change["patch"])
        self.assertIn("+resolved", change["patch"])
        self.assertNotIn("-feature", change["patch"])
        for entry in entries:
            self.assertNotIn("MERGED_OTHER_FILE_SECRET", self.single_change(entry)["patch"])

    def test_deleted_and_recreated_post_includes_both_lifetimes(self):
        post = "_posts/2026-10-06-reused.md"
        self.write(post, "old version\n")
        first = self.commit("Create first version")
        self.git("rm", "--", post)
        deleted = self.commit("Delete post")
        self.write(post, "new version\n")
        recreated = self.commit("Recreate post")

        entries = self.history()[post]
        self.assertEqual([entry["sha"] for entry in entries], [recreated, deleted, first])
        deletion = self.single_change(entries[1])
        self.assertTrue(deletion["status"].startswith("D"))
        self.assertEqual((deletion["additions"], deletion["deletions"]), (0, 4))
        self.assertIn("-old version", deletion["patch"])
        self.assertIn("+new version", self.single_change(entries[0])["patch"])

    def test_untracked_post_is_present_with_empty_history(self):
        self.write("README.md", "site\n")
        self.commit("Initialize site")
        post = "_posts/2026-10-07-future.markdown"
        self.write(post, "draft post\n")

        self.assertEqual(self.history()[post], [])

    def test_discovery_ignores_files_that_jekyll_will_not_treat_as_posts(self):
        post = "_posts/2026-10-06-real-post.md"
        self.write(post, "real post\n")
        self.write("_posts/example-post.md", "undated draft\n")
        self.write("_posts/2026-13-06-invalid-date.md", "invalid date\n")
        no_front_matter = self.root / "_posts/2026-10-06-no-front-matter.md"
        no_front_matter.write_text("plain Markdown without front matter\n", encoding="utf-8")
        self.commit("Create real post and non-post files")

        self.assertEqual(set(self.history()), {post})

    def test_cli_uses_its_site_directory_and_generates_json_for_future_posts(self):
        self.write("scripts/post-history.py", SCRIPT.read_bytes())
        first_post = "_posts/2026-10-06-first.md"
        self.write(first_post, "hej världen\n")
        first = self.commit("Publish first post")
        script = self.root / "scripts/post-history.py"

        def run_cli():
            result = subprocess.run(
                [sys.executable, str(script), "--repository", "example/blog"],
                cwd=self.temporary.name,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                check=False,
            )
            self.assertEqual(result.returncode, 0, result.stderr.decode("utf-8", "replace"))
            output = self.root / "_data/post_history.json"
            self.assertTrue(output.is_file())
            return json.loads(output.read_text(encoding="utf-8"))

        data = run_cli()
        self.assertEqual(set(data), {first_post})
        self.assertEqual(data[first_post][0]["sha"], first)
        self.assertIn("+hej världen", self.single_change(data[first_post][0])["patch"])
        self.assertFalse((Path(self.temporary.name) / "_data").exists())

        future_post = "_posts/nested/2026-10-07-future.markdown"
        self.write(future_post, "".join(
            f"entirely different future paragraph {index}\n" for index in range(12)
        ))
        future = self.commit("Publish another post")
        data = run_cli()
        self.assertEqual(set(data), {first_post, future_post})
        self.assertEqual([entry["sha"] for entry in data[first_post]], [first])
        self.assertEqual([entry["sha"] for entry in data[future_post]], [future])

    def test_shallow_history_is_rejected_instead_of_silently_truncated(self):
        post = "_posts/2026-10-06-shallow.md"
        self.write(post, "first\n")
        self.commit("First version")
        self.write(post, "second\n")
        self.commit("Second version")
        shallow = Path(self.temporary.name) / "shallow"
        subprocess.run(
            ["git", "clone", "--quiet", "--depth", "1", self.root.as_uri(), str(shallow)],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=True,
        )

        with self.assertRaisesRegex(ValueError, "(?i)shallow|full.*history"):
            self.module.generate_history(shallow, "example/blog")


if __name__ == "__main__":
    unittest.main()
