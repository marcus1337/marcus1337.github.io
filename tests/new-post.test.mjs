import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, mkdirSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { createPost, publicationDate, slugify, validateDate } from '../scripts/new-post.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));

function fixture(t) {
  const path = mkdtempSync(join(tmpdir(), 'astro-new-post-'));
  t.after(() => rmSync(path, { recursive: true, force: true }));
  return path;
}

test('slugs normalize accents and punctuation and remain URL-safe', () => {
  assert.equal(slugify('  Héj, världen! C++ & systems  '), 'hej-varlden-c-systems');
  assert.equal(slugify('../../../../Danger $HOME'), 'danger-home');
  assert.equal(slugify('a'.repeat(105)), 'a'.repeat(100));
  assert.equal(slugify('---'), '');
});

test('publication dates use Stockholm, including winter and summer day boundaries', () => {
  assert.equal(publicationDate(new Date('2026-01-01T22:30:00Z')), '2026-01-01');
  assert.equal(publicationDate(new Date('2026-01-01T23:30:00Z')), '2026-01-02');
  assert.equal(publicationDate(new Date('2026-07-01T22:30:00Z')), '2026-07-02');
});

test('explicit publication dates reject normalization of nonexistent calendar dates', () => {
  assert.equal(validateDate('2028-02-29'), '2028-02-29');
  for (const invalid of ['2026-02-29', '2026-02-31', '2026-13-01', '2026-00-01', '2026-1-1', 'tomorrow']) {
    assert.throws(() => validateDate(invalid), /real date/);
  }
});

test('new posts have valid minimal frontmatter and escaped human titles', (t) => {
  const site = fixture(t);
  const title = 'My "quoted" title\nwith a second line: true';
  const post = createPost({ root: site, title, date: '2026-10-08' });
  assert.equal(post.relativePath, 'src/content/blog/my-quoted-title-with-a-second-line-true.md');
  assert.equal(readFileSync(post.path, 'utf8'),
    `---\ntitle: ${JSON.stringify(title)}\npubDate: 2026-10-08\n---\n\n`);
  assert.throws(() => createPost({ root: site, title: '?!', date: '2026-10-08' }), /letter or number/);
});

test('draft and MDX options create explicit metadata without a client framework', (t) => {
  const site = fixture(t);
  const post = createPost({ root: site, title: 'An interactive experiment', date: '2026-10-08', draft: true, mdx: true });
  assert.match(post.path, /an-interactive-experiment\.mdx$/);
  assert.match(readFileSync(post.path, 'utf8'), /pubDate: 2026-10-08\ndraft: true\n---/);
});

test('existing posts survive repeated commands and Markdown/MDX slug collisions', (t) => {
  const site = fixture(t);
  const post = createPost({ root: site, title: 'Keep this post', date: '2026-10-08' });
  const original = readFileSync(post.path);
  for (const mdx of [false, true]) {
    assert.throws(() => createPost({ root: site, title: 'Keep this post!', date: '2026-10-09', mdx }), /Already exists/);
    assert.deepEqual(readFileSync(post.path), original);
  }
});

test('CLI creates content relative to its repository even from another working directory', (t) => {
  const site = fixture(t);
  const cwd = fixture(t);
  const script = join(site, 'scripts', 'new-post.mjs');
  mkdirSync(dirname(script), { recursive: true });
  copyFileSync(join(root, 'scripts', 'new-post.mjs'), script);
  const result = spawnSync(process.execPath,
    [script, 'A future post', '--date', '2026-10-09', '--draft'], { cwd, encoding: 'utf8' });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Created src\/content\/blog\/a-future-post\.md/);
  assert.match(readFileSync(join(site, 'src/content/blog/a-future-post.md'), 'utf8'), /draft: true/);
  const repeated = spawnSync(process.execPath,
    [script, 'A future post', '--date', '2026-10-09'], { cwd, encoding: 'utf8' });
  assert.ifError(repeated.error);
  assert.equal(repeated.status, 1);
  assert.match(repeated.stderr, /Already exists/);
});
