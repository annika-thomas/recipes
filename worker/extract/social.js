/**
 * Reels, TikToks and shorts.
 *
 * What's actually possible here is narrower than it looks, so it's worth being
 * plain about it: we can read the **caption**, not the video. Nobody is
 * transcribing the audio — that would mean downloading the video, which these
 * platforms don't allow and which would cost real money per import.
 *
 * In practice that's fine more often than you'd think, because food creators
 * put the recipe in the caption precisely so people can save it. When they
 * don't, the import comes back honest about it rather than inventing the parts
 * the video showed: you get the title, the link, and a note saying the caption
 * had no method, and you can screenshot the on-screen text instead.
 *
 * Reliability, honestly:
 *   TikTok    — oEmbed is public and unauthenticated. Works.
 *   YouTube   — the description is in the page. Usually works.
 *   Instagram — logged-out access is actively discouraged and gets worse over
 *               time. Works often enough to be worth trying, fails clearly.
 */

import { HttpError } from '../lib/http.js';
import { fetchPage, meta, parseUrl } from './page.js';

export function socialPlatform(url) {
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  if (host === 'tiktok.com' || host.endsWith('.tiktok.com') || host === 'vm.tiktok.com') return 'tiktok';
  if (host === 'instagram.com' || host.endsWith('.instagram.com') || host === 'instagr.am') return 'instagram';
  if (host === 'youtube.com' || host.endsWith('.youtube.com') || host === 'youtu.be') return 'youtube';
  return null;
}

async function oembed(endpoint) {
  try {
    const res = await fetch(endpoint, {
      headers: { accept: 'application/json', 'user-agent': 'Kitchen/1.0 (+recipe importer)' },
      cf: { cacheTtl: 600, cacheEverything: true },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function fromTikTok(url) {
  const data = await oembed(`https://www.tiktok.com/oembed?url=${encodeURIComponent(url.toString())}`);
  if (!data?.title) {
    throw new HttpError(422, "TikTok wouldn't give us that post. If it's private or age-restricted, screenshot the recipe instead.");
  }
  return {
    caption: data.title,
    author: data.author_name ? `@${String(data.author_unique_id || data.author_name).replace(/^@/, '')}` : 'TikTok',
    thumbnail: data.thumbnail_url || null,
    platform: 'TikTok',
  };
}

async function fromYouTube(url) {
  const [data, page] = await Promise.all([
    oembed(`https://www.youtube.com/oembed?url=${encodeURIComponent(url.toString())}&format=json`),
    fetchPage(url).catch(() => null),
  ]);

  // The full description lives in the page's embedded player config.
  let description = null;
  if (page?.html) {
    const m = /"shortDescription":"((?:[^"\\]|\\.)*)"/.exec(page.html);
    if (m) {
      try {
        description = JSON.parse(`"${m[1]}"`);
      } catch {
        description = m[1].replace(/\\n/g, '\n').replace(/\\"/g, '"');
      }
    }
  }

  const title = data?.title || (page?.html ? meta(page.html, 'og:title') : null);
  if (!title && !description) {
    throw new HttpError(422, "Couldn't read that YouTube video's description.");
  }

  return {
    caption: [title, description].filter(Boolean).join('\n\n'),
    author: data?.author_name || 'YouTube',
    thumbnail: data?.thumbnail_url || null,
    platform: 'YouTube',
  };
}

async function fromInstagram(url) {
  const page = await fetchPage(url).catch(() => null);

  if (page?.html) {
    // og:description on a reel reads: 123 likes, 4 comments - user on Sep 1: "caption"
    const description = meta(page.html, 'og:description');
    const author = meta(page.html, 'og:title');
    const thumbnail = meta(page.html, 'og:image');

    if (description && description.length > 40) {
      const quoted = /["“]([\s\S]+)["”]\s*$/.exec(description);
      const caption = quoted ? quoted[1] : description;
      const handle = /^([\w.]+)\s+on Instagram/i.exec(author || '')?.[1]
        || /-\s*([\w.]+)\s+on\s/i.exec(description)?.[1];

      return {
        caption,
        author: handle ? `@${handle}` : 'Instagram',
        thumbnail: thumbnail || null,
        platform: 'Instagram',
      };
    }
  }

  throw new HttpError(422, [
    "Instagram wouldn't show us that reel — it hides posts from anyone not logged in, and it does that more and more.",
    'Two things that do work: screenshot the caption (or the on-screen recipe) and import the photo, or copy the caption text and paste it in.',
  ].join(' '));
}

/**
 * Get whatever text a social post is willing to give us.
 * Throws an HttpError with a useful next step when the platform says no.
 */
export async function fetchSocialPost(input) {
  const url = typeof input === 'string' ? parseUrl(input) : input;
  const platform = socialPlatform(url);

  if (platform === 'tiktok') return { ...await fromTikTok(url), url: url.toString() };
  if (platform === 'youtube') return { ...await fromYouTube(url), url: url.toString() };
  if (platform === 'instagram') return { ...await fromInstagram(url), url: url.toString() };

  throw new HttpError(400, 'That link is not a TikTok, Instagram or YouTube post.');
}

/**
 * Does this caption plausibly contain a recipe, or just a vibe and 30 hashtags?
 * Used to warn before spending a model call on "recipe in my bio 🔥".
 */
export function captionLooksThin(caption) {
  const withoutTags = String(caption || '').replace(/#[\w]+/g, '').trim();
  const hasQuantities = /\d\s*(?:g|kg|ml|l|oz|lb|cup|tbsp|tsp|clove|can|tin)\b/i.test(withoutTags);
  const hasLines = withoutTags.split('\n').filter((l) => l.trim().length > 2).length >= 4;
  return withoutTags.length < 120 || (!hasQuantities && !hasLines);
}
