import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { getPostHistory, parseHistory } from '../src/lib/post-history.mjs';

const FRONT_MATTER = '---\ntitle: Example\n---\n';

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'astro-post-history-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const root = join(directory, 'site');
  mkdirSync(root);
  let sequence = 0;
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
  git('init', '--quiet', '--initial-branch=main');
  git('config', 'user.name', 'History Test');
  git('config', 'user.email', 'history@example.invalid');
  git('config', 'commit.gpgsign', 'false');
  git('config', 'core.autocrlf', 'false');
  const write = (path, body, frontmatter = true) => {
    const target = join(root, path);
    mkdirSync(dirname(target), { recursive: true });
    const content = Buffer.isBuffer(body) ? body : Buffer.from(body);
    writeFileSync(target, frontmatter ? Buffer.concat([Buffer.from(FRONT_MATTER), content]) : content);
  };
  const commit = (message) => {
    sequence += 1;
    git('add', '--all');
    const date = `2026-10-08T12:00:${String(sequence).padStart(2, '0')}+00:00`;
    execFileSync('git', ['-C', root, 'commit', '--quiet', '-m', message], {
      env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return git('rev-parse', 'HEAD').toString().trim();
  };
  const history = (path, migration = null) => getPostHistory(root, path, { repository: 'example/blog', migration });
  return { root, directory, git, write, commit, history };
}

function change(entry) {
  assert.equal(entry.changes.length, 1);
  return entry.changes[0];
}

test('only commits and diffs for the requested post appear, including the root', (t) => {
  const f = fixture(t);
  const post = 'src/content/blog/example.md';
  f.write(post, 'first\n');
  f.write('other.txt', 'EXTERNAL_ROOT_SECRET\n', false);
  const first = f.commit('Create post and another file');
  f.write(post, 'first\nsecond\n');
  f.write('other.txt', 'EXTERNAL_EDIT_SECRET\n', false);
  const second = f.commit('Edit both files');
  f.write('other.txt', 'UNRELATED_SECRET\n', false);
  f.commit('Only edit another file');
  const entries = f.history(post);
  assert.deepEqual(entries.map((entry) => entry.sha), [second, first]);
  assert.equal(entries[0].short_sha, second.slice(0, 12));
  assert.equal(entries[0].url, `https://github.com/example/blog/commit/${second}`);
  assert.match(entries[0].date, /^2026-10-08T/);
  assert.deepEqual([change(entries[0]).additions, change(entries[0]).deletions], [1, 0]);
  assert.deepEqual([change(entries[1]).additions, change(entries[1]).deletions], [4, 0]);
  assert.equal(change(entries[1]).parent, null);
  for (const entry of entries) {
    assert.equal(change(entry).path, post);
    assert.doesNotMatch(change(entry).patch, /SECRET|other\.txt/);
  }
});

test('a pure rename follows old history and adds no lines', (t) => {
  const f = fixture(t);
  const old = 'src/content/blog/original.md';
  const next = 'src/content/blog/renamed.mdx';
  f.write(old, 'alpha\nbeta\ngamma\n');
  const first = f.commit('Original post');
  f.git('mv', '--', old, next);
  const renamed = f.commit('Rename post');
  f.write(next, 'alpha\nrevised beta\ngamma\n');
  const edited = f.commit('Revise renamed post');
  const entries = f.history(next);
  assert.deepEqual(entries.map((entry) => entry.sha), [edited, renamed, first]);
  assert.match(change(entries[1]).status, /^R/);
  assert.equal(change(entries[1]).old_path, old);
  assert.equal(change(entries[1]).path, next);
  assert.deepEqual([change(entries[1]).additions, change(entries[1]).deletions], [0, 0]);
  assert.equal(change(entries[1]).patch, '');
  assert.equal(change(entries[2]).path, old);
  assert.match(change(entries[0]).patch, /\+revised beta/);
});

test('rename/copy plus reuse of the old filename never leaks the replacement file', (t) => {
  const f = fixture(t);
  const old = 'src/content/blog/original.md';
  const next = 'src/content/blog/moved.md';
  const body = Array.from({ length: 20 }, (_, index) => `paragraph number ${index}\n`).join('');
  f.write(old, body);
  const first = f.commit('Original');
  f.git('mv', '--', old, next);
  f.write(next, body.replace('paragraph number 5\n', 'paragraph edited 5\n'));
  f.write(old, 'OLD_PATH_RECREATED_SECRET\n');
  const moved = f.commit('Move, edit, and replace the old file');
  const entries = f.history(next);
  assert.deepEqual(entries.map((entry) => entry.sha), [moved, first]);
  const result = change(entries[0]);
  assert.match(result.status, /^[RC]/);
  assert.equal(result.old_path, old);
  assert.equal(result.path, next);
  assert.deepEqual([result.additions, result.deletions], [1, 1]);
  assert.match(result.patch, /-paragraph number 5\n\+paragraph edited 5/);
  assert.doesNotMatch(result.patch, /OLD_PATH_RECREATED_SECRET/);
});

test('literal Unicode, newline, tab, quote, backslash and glob-like paths work', (t) => {
  const f = fixture(t);
  const post = 'src/content/blog/a folder\tλ\n[folder]/a"\\[draft]λ.md';
  const decoy = 'src/content/blog/a folder\tλ\nf/a"\\dλ.md';
  f.write(post, 'hej världen\n');
  f.write(decoy, 'other\n');
  const first = f.commit('Unusual paths');
  f.write(decoy, 'PATHSPEC_DECOY_SECRET\n');
  f.commit('Other post only');
  const entries = f.history(post);
  assert.deepEqual(entries.map((entry) => entry.sha), [first]);
  assert.equal(change(entries[0]).path, post);
  assert.match(change(entries[0]).patch, /\+hej världen/);
  assert.doesNotMatch(change(entries[0]).patch, /PATHSPEC_DECOY_SECRET/);
});

test('renamed unusual paths relabel only headers, preserving hunk content', (t) => {
  const f = fixture(t);
  const old = 'src/content/blog/old\n"λ.md';
  const next = 'src/content/blog/new\tλ.md';
  const body = 'line\n'.repeat(20);
  f.write(old, body);
  const first = f.commit('Old unusual name');
  f.git('mv', '--', old, next);
  f.write(next, `${'line\n'.repeat(19)}edited\n`);
  const renamed = f.commit('Rename and edit');
  const entries = f.history(next);
  assert.deepEqual(entries.map((entry) => entry.sha), [renamed, first]);
  assert.equal(change(entries[0]).old_path, old);
  assert.deepEqual([change(entries[0]).additions, change(entries[0]).deletions], [1, 1]);
  assert.match(change(entries[0]).patch, /old\\n\\"λ\.md/);
  assert.match(change(entries[0]).patch, /-line\n\+edited/);
});

test('multiline and hostile messages cannot corrupt history or patch framing', (t) => {
  const f = fixture(t);
  const post = 'src/content/blog/message.md';
  f.write(post, 'actual text\n');
  const message = 'Subject with <script> & "quotes" and å\n\n'
    + 'Body with fake markers: \x1e\x1f\ncommit deadbeef\n'
    + 'diff --git a/unrelated.txt b/unrelated.txt\n@@ -1 +1 @@\n'
    + '+MESSAGE_ONLY_SECRET\n\nLast paragraph.';
  const sha = f.commit(message);
  const entry = f.history(post)[0];
  assert.equal(entry.sha, sha);
  assert.equal(entry.subject, message.split('\n')[0]);
  assert.equal(entry.message.trimEnd(), message);
  assert.match(change(entry).patch, /\+actual text/);
  assert.doesNotMatch(change(entry).patch, /MESSAGE_ONLY_SECRET|unrelated\.txt/);
});

test('binary changes show a binary diff and unknown line counts', (t) => {
  const f = fixture(t);
  const post = 'src/content/blog/binary.md';
  f.write(post, Buffer.from('\x00previous\n'));
  const first = f.commit('Binary original');
  f.write(post, Buffer.from('\x00current\n'));
  const second = f.commit('Binary edit');
  const entries = f.history(post);
  assert.deepEqual(entries.map((entry) => entry.sha), [second, first]);
  for (const entry of entries) {
    assert.equal(change(entry).additions, null);
    assert.equal(change(entry).deletions, null);
    assert.match(change(entry).patch, /Binary files/);
  }
});

test('conflict merges keep both branches and compare the merge with its first parent', (t) => {
  const f = fixture(t);
  const post = 'src/content/blog/merge.md';
  f.write(post, 'base\n');
  const base = f.commit('Base');
  f.git('checkout', '-b', 'feature');
  f.write(post, 'feature\n');
  f.write('other.txt', 'MERGED_OTHER_FILE_SECRET\n', false);
  const feature = f.commit('Feature');
  f.git('checkout', 'main');
  f.write(post, 'main\n');
  const main = f.commit('Main');
  const merge = spawnSync('git', ['-C', f.root, 'merge', '--no-ff', '--no-commit', 'feature']);
  assert.equal(merge.status, 1);
  f.write(post, 'resolved\n');
  const resolved = f.commit('Resolve');
  const entries = f.history(post);
  assert.equal(entries[0].sha, resolved);
  assert.deepEqual(new Set(entries.map((entry) => entry.sha)), new Set([resolved, main, feature, base]));
  assert.equal(entries[0].is_merge, true);
  assert.equal(change(entries[0]).parent, main.slice(0, 12));
  assert.deepEqual([change(entries[0]).additions, change(entries[0]).deletions], [1, 1]);
  assert.match(change(entries[0]).patch, /-main\n\+resolved/);
  for (const entry of entries) assert.doesNotMatch(change(entry).patch, /MERGED_OTHER_FILE_SECRET/);
});

test('deleted and recreated filenames retain both lifetimes', (t) => {
  const f = fixture(t);
  const post = 'src/content/blog/reused.md';
  f.write(post, 'old version\n');
  const first = f.commit('Create');
  f.git('rm', '--', post);
  const deleted = f.commit('Delete');
  f.write(post, 'new version\n');
  const recreated = f.commit('Recreate');
  const entries = f.history(post);
  assert.deepEqual(entries.map((entry) => entry.sha), [recreated, deleted, first]);
  assert.equal(change(entries[1]).status, 'D');
  assert.deepEqual([change(entries[1]).additions, change(entries[1]).deletions], [0, 4]);
});

test('uncommitted content has no invented commit or working-tree diff', (t) => {
  const f = fixture(t);
  f.write('README.md', 'site\n', false);
  f.commit('Initialize');
  f.write('src/content/blog/draft.mdx', 'not committed\n');
  assert.deepEqual(f.history('src/content/blog/draft.mdx'), []);
});

test('shallow repositories fail explicitly instead of silently truncating history', (t) => {
  const f = fixture(t);
  const post = 'src/content/blog/shallow.md';
  f.write(post, 'first\n');
  f.commit('First');
  f.write(post, 'second\n');
  const second = f.commit('Second');
  // Git's shallow boundary is repository metadata, independent of whether old
  // unreachable objects have already been pruned. No transport is needed here.
  writeFileSync(join(f.root, '.git/shallow'), `${second}\n`);
  assert.equal(f.git('rev-parse', '--is-shallow-repository').toString().trim(), 'true');
  assert.equal(f.git('log', '--format=%H').toString().trim(), second);
  assert.throws(() => f.history(post), /Full Git history/);
});

test('migration bridge preserves old history before and after a heavily rewritten move', (t) => {
  const f = fixture(t);
  const legacy = '_posts/2026-10-06-original.md';
  const post = 'src/content/blog/original.md';
  f.write(legacy, 'original prose\n'.repeat(30));
  const first = f.commit('Original published post');
  const migration = { ref: first, paths: { [post]: legacy } };
  f.git('rm', '--', legacy);
  f.write(post, 'completely rewritten demo syntax\n'.repeat(50));
  assert.deepEqual(f.history(post, migration).map((entry) => entry.sha), [first]);
  const moved = f.commit('Astro migration');
  assert.deepEqual(f.history(post, migration).map((entry) => entry.sha), [moved, first]);
  f.write(legacy, 'OLD_PATH_AFTER_MIGRATION_SECRET\n');
  const reused = f.commit('Reuse old path for something unrelated');
  const entries = f.history(post, migration);
  assert.deepEqual(entries.map((entry) => entry.sha), [moved, first]);
  assert.ok(!entries.some((entry) => entry.sha === reused));
  for (const entry of entries) assert.doesNotMatch(change(entry).patch, /OLD_PATH_AFTER_MIGRATION_SECRET/);
});

test('a later rename still finds the explicit migration bridge through its path lineage', (t) => {
  const f = fixture(t);
  const legacy = '_posts/2026-10-06-original.md';
  const post = 'src/content/blog/original.md';
  const renamed = 'src/content/blog/better-name.mdx';
  f.write(legacy, 'old demo content\n'.repeat(30));
  const first = f.commit('Original');
  const migration = { ref: first, paths: { [post]: legacy } };
  f.git('rm', '--', legacy);
  f.write(post, 'different Astro examples\n'.repeat(50));
  const moved = f.commit('Migration');
  f.git('mv', '--', post, renamed);
  const rename = f.commit('Improve filename');
  assert.deepEqual(f.history(renamed, migration).map((entry) => entry.sha), [rename, moved, first]);
});

test('migration history is deduplicated when Git itself detects the move', (t) => {
  const f = fixture(t);
  const legacy = '_posts/2026-10-06-original.md';
  const post = 'src/content/blog/original.md';
  f.write(legacy, 'the same content\n'.repeat(20));
  const first = f.commit('Original');
  mkdirSync(dirname(join(f.root, post)), { recursive: true });
  f.git('mv', '--', legacy, post);
  const moved = f.commit('Move');
  const migration = { ref: first, paths: { [post]: legacy } };
  assert.deepEqual(f.history(post, migration).map((entry) => entry.sha), [moved, first]);
});

test('the anchored legacy scan preserves both branches and the original merge diff', (t) => {
  const f = fixture(t);
  const legacy = '_posts/2026-10-06-merge.md';
  const post = 'src/content/blog/merge.md';
  f.write(legacy, 'base\n');
  const base = f.commit('Base legacy post');
  f.git('checkout', '-b', 'feature');
  f.write(legacy, 'feature\n');
  const feature = f.commit('Feature legacy edit');
  f.git('checkout', 'main');
  f.write(legacy, 'main\n');
  const main = f.commit('Main legacy edit');
  const merge = spawnSync('git', ['-C', f.root, 'merge', '--no-ff', '--no-commit', 'feature']);
  assert.equal(merge.status, 1);
  f.write(legacy, 'resolved\n');
  const resolved = f.commit('Resolve legacy conflict');
  const migration = { ref: resolved, paths: { [post]: legacy } };
  f.git('rm', '--', legacy);
  f.write(post, 'updated Astro-only demonstration\n'.repeat(50));
  const before = f.history(post, migration);
  assert.equal(before[0].sha, resolved);
  assert.deepEqual(new Set(before.map((entry) => entry.sha)), new Set([resolved, main, feature, base]));
  assert.match(change(before[0]).patch, /-main\n\+resolved/);
  const moved = f.commit('Migrate the merged article');
  const after = f.history(post, migration);
  assert.equal(after[0].sha, moved);
  assert.deepEqual(new Set(after.map((entry) => entry.sha)), new Set([moved, resolved, main, feature, base]));
  assert.equal(change(after.find((entry) => entry.sha === resolved)).parent, main.slice(0, 12));
});

test('Git display configuration cannot corrupt machine parsing or invoke external diffs', (t) => {
  const f = fixture(t);
  const post = 'src/content/blog/config.md';
  f.write(post, 'first\n');
  f.commit('Original');
  f.write(post, 'second\n');
  f.commit('Edit');
  const expected = f.history(post);
  f.git('config', 'color.ui', 'always');
  f.git('config', 'log.showSignature', 'true');
  f.git('config', 'core.quotePath', 'false');
  f.git('config', 'diff.noprefix', 'true');
  f.git('config', 'diff.external', 'false');
  assert.deepEqual(f.history(post), expected);
});

test('source paths outside the repository and invalid UTF-8 paths are rejected', (t) => {
  const f = fixture(t);
  assert.throws(() => f.history('../other.md'), /inside the repository/);
  const raw = Buffer.concat([Buffer.from(`${'a'.repeat(40)}\0\nA\0_posts/`), Buffer.from([0xff]), Buffer.from('.md\0')]);
  assert.throws(() => parseHistory(raw), /UTF-8/);
});

test('a filename resembling a SHA is consumed as a filename', () => {
  const sha = 'a'.repeat(40);
  const filename = 'b'.repeat(40);
  const raw = Buffer.from(`${sha}\0\nA\0${filename}\0`);
  assert.deepEqual(parseHistory(raw), [{ sha, files: [{ status: 'A', old_path: filename, path: filename }] }]);
});
