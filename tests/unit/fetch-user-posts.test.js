'use strict';

const {
  parsePort,
  parseCliArgs,
  normalizeTarget,
  mapMediaType,
  resolvePostPathPrefix,
  normalizePost,
} = require('../../fetch-user-posts');

describe('fetch-user-posts cli parsing', () => {
  it('parses required target and options', () => {
    const args = parseCliArgs([
      'https://www.instagram.com/nike/',
      '--limit', '24',
      '--output', './logs/nike.json',
      '--debug-port', '9333',
      '--keep-connected',
    ]);

    expect(args.error).toBe('');
    expect(args.target).toBe('https://www.instagram.com/nike/');
    expect(args.limit).toBe(24);
    expect(args.output).toBe('./logs/nike.json');
    expect(args.debugPort).toBe(9333);
    expect(args.keepConnected).toBe(true);
  });

  it('rejects invalid limit', () => {
    const args = parseCliArgs(['nike', '--limit', '0']);
    expect(args.error).toContain('limit');
  });

  it('rejects unknown option', () => {
    const args = parseCliArgs(['nike', '--bad']);
    expect(args.error).toContain('未知参数');
  });
});

describe('normalizeTarget', () => {
  it('accepts username and @username', () => {
    expect(normalizeTarget('nike')).toEqual({
      username: 'nike',
      profileUrl: 'https://www.instagram.com/nike/',
    });
    expect(normalizeTarget('@nike')).toEqual({
      username: 'nike',
      profileUrl: 'https://www.instagram.com/nike/',
    });
  });

  it('accepts instagram profile url', () => {
    expect(normalizeTarget('https://www.instagram.com/nike/?hl=en')).toEqual({
      username: 'nike',
      profileUrl: 'https://www.instagram.com/nike/',
    });
  });

  it('rejects invalid target', () => {
    expect(normalizeTarget('https://example.com/u')).toHaveProperty('error');
    expect(normalizeTarget('')).toHaveProperty('error');
  });
});

describe('mapMediaType', () => {
  it('maps item media types', () => {
    expect(mapMediaType({ media_type: 1 })).toBe('image');
    expect(mapMediaType({ media_type: 2 })).toBe('video');
    expect(mapMediaType({ media_type: 8 })).toBe('carousel');
  });
});

describe('normalizePost', () => {
  it('normalizes image post', () => {
    const post = normalizePost({
      id: '1',
      pk: '1',
      code: 'ABC123',
      media_type: 1,
      product_type: 'feed',
      caption: { text: 'hello' },
      like_count: 10,
      comment_count: 2,
      taken_at: 1700000000,
      image_versions2: { candidates: [{ url: 'https://img.jpg' }] },
      video_versions: [],
    }, 'nike');

    expect(post.shortcode).toBe('ABC123');
    expect(post.mediaType).toBe('image');
    expect(post.postUrl).toBe('https://www.instagram.com/nike/p/ABC123/');
    expect(post.primaryMediaUrl).toBe('https://img.jpg');
    expect(post.mediaUrls).toEqual(['https://img.jpg']);
    expect(post.likeCount).toBe(10);
    expect(post.commentCount).toBe(2);
    expect(post.takenAt).toBe('2023-11-14T22:13:20.000Z');
  });

  it('normalizes reel post to /reel/', () => {
    const post = normalizePost({
      code: 'REEL01',
      media_type: 2,
      product_type: 'clips',
      video_versions: [{ url: 'https://video.mp4' }],
      image_versions2: { candidates: [{ url: 'https://cover.jpg' }] },
    }, 'nike');

    expect(post.mediaType).toBe('video');
    expect(post.postUrl).toBe('https://www.instagram.com/nike/reel/REEL01/');
    expect(post.primaryMediaUrl).toBe('https://video.mp4');
    expect(post.mediaUrls).toContain('https://video.mp4');
    expect(post.mediaUrls).toContain('https://cover.jpg');
  });

  it('supports primary-only media normalization for fast mode callers', () => {
    const post = normalizePost({
      code: 'REEL02',
      media_type: 8,
      product_type: 'clips',
      carousel_media: [
        {
          media_type: 1,
          image_versions2: { candidates: [{ url: 'https://img-1.jpg' }] },
        },
        {
          media_type: 2,
          image_versions2: { candidates: [{ url: 'https://cover-2.jpg' }] },
          video_versions: [{ url: 'https://video-2.mp4' }],
        },
      ],
      image_versions2: { candidates: [{ url: 'https://cover-root.jpg' }] },
      video_versions: [{ url: 'https://video-root.mp4' }],
    }, 'nike', { includeAllMedia: false });

    expect(post.primaryMediaUrl).toBe('https://video-root.mp4');
    expect(post.mediaUrls).toEqual(['https://video-root.mp4']);
  });

  it('normalizes non-clips video post to /p/', () => {
    const post = normalizePost({
      code: 'VIDEO01',
      media_type: 2,
      product_type: 'feed',
      video_versions: [{ url: 'https://video.mp4' }],
      image_versions2: { candidates: [{ url: 'https://cover.jpg' }] },
    }, 'nike');

    expect(post.mediaType).toBe('video');
    expect(post.postUrl).toBe('https://www.instagram.com/nike/p/VIDEO01/');
  });
});

describe('resolvePostPathPrefix', () => {
  it('maps by product type', () => {
    expect(resolvePostPathPrefix({ product_type: 'clips' })).toBe('reel');
    expect(resolvePostPathPrefix({ product_type: 'igtv' })).toBe('tv');
    expect(resolvePostPathPrefix({ product_type: 'feed' })).toBe('p');
    expect(resolvePostPathPrefix({})).toBe('p');
  });
});

describe('parsePort', () => {
  it('parses valid port and fallback for invalid', () => {
    expect(parsePort('9222', null)).toBe(9222);
    expect(parsePort('0', 9222)).toBe(9222);
  });
});
