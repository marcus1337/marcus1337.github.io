#!/usr/bin/env node
/** Create a Markdown or MDX entry using only Node's standard library. */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

export function slugify(title) {
  return title.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    .slice(0, 100).replace(/-$/g, '');
}

export function publicationDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: 'Europe/Stockholm', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const part = (name) => parts.find(({ type }) => type === name).value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function validateDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error('Publication date must be a real date in YYYY-MM-DD format.');
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error('Publication date must be a real date in YYYY-MM-DD format.');
  }
  return value;
}

export function createPost({ root, title, date, draft = false, mdx = false }) {
  const cleanTitle = String(title ?? '').trim();
  const slug = slugify(cleanTitle);
  if (!slug) throw new Error('Use a title containing at least one letter or number.');
  const pubDate = validateDate(date ?? publicationDate());
  const site = resolve(root);
  const directory = join(site, 'src', 'content', 'blog');
  for (const extension of ['md', 'mdx']) {
    const candidate = join(directory, `${slug}.${extension}`);
    if (existsSync(candidate)) {
      throw new Error(`Already exists: ${relative(site, candidate)}; existing post was not changed.`);
    }
  }
  const path = join(directory, `${slug}.${mdx ? 'mdx' : 'md'}`);
  const frontmatter = `---\ntitle: ${JSON.stringify(cleanTitle)}\npubDate: ${pubDate}\n`
    + (draft ? 'draft: true\n' : '') + '---\n\n';
  mkdirSync(directory, { recursive: true });
  // Exclusive creation also prevents an accidental overwrite between the check and write.
  writeFileSync(path, frontmatter, { encoding: 'utf8', flag: 'wx' });
  return { path, relativePath: relative(site, path), slug, pubDate };
}

function main() {
  try {
    const { values, positionals } = parseArgs({
      allowPositionals: true,
      options: {
        date: { type: 'string' }, draft: { type: 'boolean' },
        mdx: { type: 'boolean' }, help: { type: 'boolean', short: 'h' },
      },
    });
    if (values.help) {
      console.log('npm run new-post -- "My new post" [--date YYYY-MM-DD] [--draft] [--mdx]');
      return 0;
    }
    if (positionals.length !== 1) throw new Error('Pass one post title in quotes. Use --help for usage.');
    const root = fileURLToPath(new URL('../', import.meta.url));
    const post = createPost({ root, title: positionals[0], ...values });
    console.log(`Created ${post.relativePath}`);
    console.log(values.draft
      ? 'Edit this draft, then remove draft: true when ready to publish.'
      : 'Edit this file, then commit and push to publish it.');
    return 0;
  } catch (error) {
    console.error(`Could not create post: ${error.message}`);
    return 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
