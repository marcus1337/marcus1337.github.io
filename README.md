# marcus1337.github.io
website

## Write a blog post

From the repository root:

```sh
python3 scripts/new-post.py "My first post"
```

Open the printed `_posts/YYYY-MM-DD-my-first-post.md` file and replace
`Write your post here.` with your text. Keep the three-line title block
at the top. Headings, links, images, and fenced code blocks use Markdown.
An optional `description: "A short summary"` line in the title block
adds a summary to the blog list.

Then review and publish:

```sh
git add _posts/
git commit -m "Add blog post"
git push
```

GitHub Pages builds the blog automatically. Posts appear at
`https://marcus1337.github.io/blog/`, newest first.
Each post URL includes its date, so posts with the same title on different
days have separate pages.

`_drafts/example-post.md` is an unpublished formatting example.
To keep a post unpublished, keep its file in `_drafts/`; move it to
`_posts/` with a `YYYY-MM-DD-` filename prefix when ready. Images can
be placed in `assets/blog/` and linked as
`![Description](/assets/blog/image.png)`.

The first post, `_posts/2026-10-04-my-first-post-thanks-chatgpt.md`, is a
working formatting demo: code, tables, lists, images, quotes, footnotes,
expandable notes and diagrams. Copy examples from it into new posts.

### Mermaid diagrams

Add `mermaid: true` below `title:` in the post's opening YAML block, then
write a fenced diagram:

````markdown
```mermaid
flowchart TB
    Idea --> Prototype
    Prototype --> Playtest
```
````

The browser loads Mermaid 12.1.0 from jsDelivr only on enabled posts.
Diagrams follow the system colour scheme and have an expandable source.
If the library cannot load or a diagram has invalid syntax, its source
remains readable. Use `accTitle:` and `accDescr:` in a diagram to describe
it for screen readers; the demo includes examples.

## First-time setup

The Blog button, list, article layout, and configuration are ready.
Review the changes, commit them, and push to enable them on the live site:

```sh
git add index.html blog/ _layouts/ _posts/ _drafts/ assets/ scripts/ _config.yml .gitignore README.md
git commit -m "Add minimal Markdown blog"
git push
```

The current Pages publishing source is `main` / repository root.
You do not need to install Jekyll locally for writing or publishing.
