import { getCollection, type CollectionEntry } from 'astro:content';

export type BlogPost = CollectionEntry<'blog'>;

export async function getPublishedPosts(): Promise<BlogPost[]> {
  const posts = await getCollection('blog', ({ data }) => !data.draft);
  return posts.sort((a, b) => b.data.pubDate.getTime() - a.data.pubDate.getTime()
    || a.id.localeCompare(b.id));
}

export function publicationDay(post: BlogPost): string {
  return post.data.pubDate.toISOString().slice(0, 10);
}

export function postSlug(post: BlogPost): string {
  return `${publicationDay(post)}-${post.id}`;
}

export function postUrl(post: BlogPost): string {
  return `/blog/${postSlug(post)}/`;
}

// A unique CSS identifier, also valid for nested and Unicode content IDs.
export function postTransitionName(post: BlogPost): string {
  return `post-${Buffer.from(post.id).toString('base64url')}`;
}

export function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
  }).format(date);
}
