/** Check deployed HTML, article rendering, and local references after astro build. */
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const dist = join(root, 'dist');
const site = 'https://marcus1337.github.io';
const posts = [
  '2026-10-04-my-first-post-thanks-chatgpt',
  '2026-10-05-my-second-post',
  '2026-10-06-how-to-blog-post',
];

function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? files(path) : [path];
  });
}

function decode(value) {
  return value.replace(/&(?:amp|quot|apos|lt|gt|#\d+|#x[\da-f]+);/gi, (entity) => {
    const named = { '&amp;': '&', '&quot;': '"', '&apos;': "'", '&lt;': '<', '&gt;': '>' };
    if (named[entity]) return named[entity];
    return String.fromCodePoint(parseInt(entity.slice(entity[2].toLowerCase() === 'x' ? 3 : 2, -1),
      entity[2].toLowerCase() === 'x' ? 16 : 10));
  });
}

function attributes(tag) {
  const result = {};
  for (const match of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
    result[match[1].toLowerCase()] = decode(match[2] ?? match[3] ?? match[4]);
  }
  return result;
}

function route(path) {
  let candidate = resolve(dist, `.${decodeURIComponent(path)}`);
  assert(candidate.startsWith(dist + '/') || candidate === dist, `Path escapes output: ${path}`);
  if (existsSync(candidate) && statSync(candidate).isDirectory()) candidate = join(candidate, 'index.html');
  assert(existsSync(candidate), `Missing deployed path: ${path}`);
  return candidate;
}

function htmlFor(path) {
  return readFileSync(route(path), 'utf8');
}

assert(existsSync(dist), 'Run npm run build before npm run test:build.');
const htmlFiles = files(dist).filter((path) => path.endsWith('.html'));
assert(htmlFiles.length >= 6, 'Expected the home, about, blog and three published post pages.');

// Standalone pages are copied as authored, without Astro markup or styling changes.
for (const [path, source] of [['/', 'index.html'], ['/about/', 'about/index.html']]) {
  assert.deepEqual(readFileSync(route(path)), readFileSync(join(root, 'public', source)),
    `${path}: original plain HTML was changed during the build`);
  assert.match(htmlFor(path), /<title>[^<]+<\/title>/, `${path}: missing original title`);
}

for (const path of ['/blog/', ...posts.map((post) => `/blog/${post}/`)]) {
  const html = htmlFor(path);
  assert.match(html, /<title>[^<]+<\/title>/, `${path}: missing title`);
  assert.match(html, /name="description"[^>]+content="[^"]+"|content="[^"]+"[^>]+name="description"/, `${path}: missing description`);
  assert.match(html, /rel="canonical"/, `${path}: missing canonical URL`);
  assert.match(html, /property="og:title"/, `${path}: missing Open Graph metadata`);
  assert.match(html, /name="twitter:card"/, `${path}: missing social metadata`);
  assert.match(html, /<main\b/, `${path}: missing main landmark`);
}

// Parse actual link and media elements, rather than matching examples escaped in code blocks.
let references = 0;
for (const path of htmlFiles) {
  const html = readFileSync(path, 'utf8');
  const pathname = '/' + relative(dist, path).replace(/\/index\.html$/, '/').replace(/^index\.html$/, '');
  for (const match of html.matchAll(/<(?:a|link|script|img|source|video|audio|iframe)\b[^>]*>/gi)) {
    const tag = attributes(match[0]);
    const reference = tag.href ?? tag.src;
    if (!reference) continue;
    const url = new URL(reference, site + pathname);
    if (url.origin !== site) continue;
    const target = route(url.pathname);
    references += 1;
    if (url.hash && target.endsWith('.html')) {
      const fragment = decodeURIComponent(url.hash.slice(1));
      const targetHtml = readFileSync(target, 'utf8');
      const ids = [...targetHtml.matchAll(/\bid\s*=\s*(?:"([^"]*)"|'([^']*)')/g)]
        .map((id) => decode(id[1] ?? id[2]));
      assert(ids.includes(fragment), `${pathname}: missing anchor ${url.pathname}${url.hash}`);
    }
  }
}

const blog = htmlFor('/blog/');
for (const post of posts) assert(blog.includes(`/blog/${post}/`), `Blog list omits ${post}`);
assert(!blog.includes('example-post'), 'Draft appeared on the public blog index.');
assert(!htmlFiles.some((path) => path.includes('example-post')), 'Draft has a public page.');

const demo = htmlFor(`/blog/${posts[0]}/`);
assert.match(demo, /<table\b/, 'Markdown table did not render.');
assert.match(demo, /<kbd>Ctrl<\/kbd>/, 'Inline HTML did not render.');
assert.match(demo, /data-footnote-ref|class="footnote-ref"/, 'Markdown footnote did not render.');
assert.match(demo, /<details\b[^>]*>[\s\S]*?<summary>Show the Markdown<\/summary>[\s\S]*?<pre\b/, 'Expandable Markdown example did not render.');
assert.match(demo, /astro-code/, 'Syntax highlighting is missing.');
assert.equal((demo.match(/data-language="mermaid"/g) ?? []).length, 2, 'Expected two Mermaid source blocks.');
assert.match(demo, /src="\/scripts\/mermaid\.js"/, 'Diagram post did not load its Mermaid wrapper.');
for (const path of ['/', '/about/', '/blog/', ...posts.slice(1).map((post) => `/blog/${post}/`)]) {
  assert(!htmlFor(path).includes('src="/scripts/mermaid.js"'), `${path}: unnecessary Mermaid script.`);
}
assert(existsSync(join(dist, 'assets/blog/markdown-demo.svg')), 'Preserved diagram image is missing.');

for (const post of posts) {
  const html = htmlFor(`/blog/${post}/`);
  assert.match(html, /post-history/, `${post}: missing post history`);
  assert.match(html, /Edit history/, `${post}: missing readable history label`);
  assert.match(html, /View this edit on GitHub/, `${post}: missing edit link label`);
  assert.match(html, /https:\/\/github\.com\/marcus1337\/marcus1337\.github\.io\/commit\/[0-9a-f]{40}/,
    `${post}: missing committed history and GitHub link`);
  assert.match(html, /source-changes/, `${post}: missing expandable source changes`);
  assert.match(html, /View source changes/, `${post}: missing source change label`);
  assert.match(html, /Changes to the post/, `${post}: missing post-only change section`);
  const historyHtml = html.slice(html.indexOf('class="post-history'));
  const historyText = decode(historyHtml.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '').replace(/<[^>]*>/g, ' '));
  assert.doesNotMatch(historyText, /\b[a-f0-9]{40}\b/, `${post}: commit SHA is visible in edit history`);
  assert.doesNotMatch(historyText, /\(M\)|\bStatus\s+(?:M|Modified)\b/,
    `${post}: technical file status is visible in edit history`);
  assert(!/<dt[^>]*>(?:File|Status|Commit|Committed)<\/dt>/.test(historyHtml),
    `${post}: technical Git metadata is visible in edit history`);
}

const projectPages = htmlFor('/') + htmlFor('/about/');
for (const name of ['Checkerboard Collection', 'Spades', 'Area Shifter 2', 'Half Robot']) {
  assert(projectPages.includes(name), `Existing project missing: ${name}`);
}
assert.match(projectPages, /Nine Men(?:&#39;|&#x27;|&apos;|')s Morris/, 'Nine Men’s Morris is missing.');
assert(projectPages.includes('clientinfo1337@gmail.com'), 'Existing email contact is missing.');
assert(projectPages.includes('discord.gg/Q26Hh2W2Mj'), 'Existing Discord contact is missing.');

const rss = readFileSync(route('/rss.xml'), 'utf8');
for (const post of posts) assert(rss.includes(`/blog/${post}/`), `RSS omits ${post}`);
assert(!rss.includes('example-post'), 'Draft appeared in RSS.');
assert(existsSync(join(dist, 'sitemap-index.xml')), 'Sitemap index is missing.');
for (const old of ['_config.yml', '_layouts', '_includes', '_posts', '_drafts', '_data', 'scripts/new-post.py', 'scripts/post-history.py']) {
  assert(!existsSync(join(root, old)), `Obsolete Jekyll file remains: ${old}`);
}
console.log(`Verified ${htmlFiles.length} HTML pages, ${references} internal links/assets, Markdown, diagrams, history, drafts, RSS and sitemap.`);
