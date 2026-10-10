# marcus1337.github.io

Astro builds the blog at `/blog/`. The homepage and About page remain plain
HTML: edit `public/index.html` and `public/about/index.html` directly.

## Run locally

Use Node.js 24 and a full Git clone.

```sh
npm ci
npm run dev
```

Open `/blog/` on the local URL printed by Astro, normally `http://localhost:4321`.

## Write a post

```sh
npm run new-post -- "My new post"
```

Edit the created file in `src/content/blog/`. The title and publication date
are filled in automatically; dates default to today in Europe/Stockholm.

Optional flags:

- `--draft`: hide the post until you remove `draft: true`.
- `--mdx`: create an MDX post that can use Astro components.
- `--date YYYY-MM-DD`: choose the publication date.

Keep published filenames and `pubDate` values stable; both form the post URL.
See [the content schema](src/content.config.ts) for optional frontmatter fields.

Put images in `public/assets/blog/` and use paths such as
`![Description](/assets/blog/image.png)` in posts. For diagrams, add
`mermaid: true` to frontmatter and use a fenced `mermaid` code block.

## Check and preview

```sh
npm run check       # Astro, TypeScript and content checks
npm test            # Regression tests
npm run build       # Generate dist/
npm run test:build  # Verify generated pages, links and assets
npm run preview     # Serve dist/ locally
```

## Publish

Commit and push to `main`. [The Pages workflow](.github/workflows/pages.yml)
checks, builds and deploys the site automatically. In GitHub repository
**Settings → Pages**, keep **Source** set to **GitHub Actions**.

Each post's edit history is generated automatically from committed changes to
that file, including recognized renames. Full Git history is required; if your
clone is shallow, run `git fetch --unshallow`. Uncommitted edits do not appear.
