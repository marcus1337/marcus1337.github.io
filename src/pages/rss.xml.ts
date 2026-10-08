import rss from '@astrojs/rss';
import type { APIContext } from 'astro';
import { BLOG_DESCRIPTION, SITE_TITLE, SITE_URL } from '../consts';
import { getPublishedPosts, postUrl } from '../lib/blog';

export async function GET(context: APIContext) {
  const posts = await getPublishedPosts();
  return rss({
    title: `${SITE_TITLE} — Blog`,
    description: BLOG_DESCRIPTION,
    site: context.site ?? SITE_URL,
    items: posts.map((post) => ({
      title: post.data.title,
      pubDate: post.data.pubDate,
      description: post.data.description,
      link: postUrl(post),
      categories: post.data.tags,
    })),
    customData: '<language>en</language>',
  });
}
