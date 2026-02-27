'use strict';

const {
  parsePort,
  parseCliArgs,
  parseProxyConfig,
  normalizeInputPayload,
  isValidInstagramPostUrl,
  mapMediaEntries,
  buildFilename,
} = require('../../download-hot-media-assets');

describe('download-hot-media-assets cli parsing', () => {
  it('parses required and optional args', () => {
    const args = parseCliArgs([
      '--input', './logs/test-hot-media-nike.json',
      '--output-dir', './downloads',
      '--concurrency', '3',
      '--retry', '2',
      '--timeout', '45000',
      '--max-posts', '5',
      '--debug-port', '9333',
      '--proxy', 'http://127.0.0.1:7890',
      '--overwrite',
      '--no-cover',
      '--keep-connected',
    ]);

    expect(args.error).toBe('');
    expect(args.input).toBe('./logs/test-hot-media-nike.json');
    expect(args.outputDir).toBe('./downloads');
    expect(args.concurrency).toBe(3);
    expect(args.retry).toBe(2);
    expect(args.timeout).toBe(45000);
    expect(args.maxPosts).toBe(5);
    expect(args.debugPort).toBe(9333);
    expect(args.proxy).toBe('http://127.0.0.1:7890');
    expect(args.overwrite).toBe(true);
    expect(args.includeCover).toBe(false);
    expect(args.keepConnected).toBe(true);
  });

  it('validates missing input and bad ranges', () => {
    expect(parseCliArgs([]).error).toContain('input');
    expect(parseCliArgs(['--input', 'x', '--concurrency', '0']).error).toContain('concurrency');
    expect(parseCliArgs(['--input', 'x', '--retry', '99']).error).toContain('retry');
    expect(parseCliArgs(['--input', 'x', '--proxy', '://bad']).error).toContain('proxy');
    expect(parseCliArgs(['--input', 'x', '--bad']).error).toContain('未知参数');
  });
});

describe('parseProxyConfig', () => {
  it('parses http proxy for axios and curl', () => {
    const cfg = parseProxyConfig('http://user:pass@127.0.0.1:7890');
    expect(cfg.curlProxy).toBe('http://user:pass@127.0.0.1:7890');
    expect(cfg.axiosProxy).toEqual({
      protocol: 'http',
      host: '127.0.0.1',
      port: 7890,
      auth: { username: 'user', password: 'pass' },
    });
    expect(cfg.masked).toContain('***');
  });

  it('parses socks proxy for curl only', () => {
    const cfg = parseProxyConfig('socks5://127.0.0.1:1080');
    expect(cfg.curlProxy).toBe('socks5://127.0.0.1:1080');
    expect(cfg.axiosProxy).toBeNull();
  });

  it('returns empty config when proxy is missing', () => {
    const cfg = parseProxyConfig('');
    expect(cfg.raw).toBe('');
    expect(cfg.curlProxy).toBe('');
    expect(cfg.axiosProxy).toBeNull();
  });
});

describe('normalizeInputPayload', () => {
  it('merges and deduplicates post urls', () => {
    const data = normalizeInputPayload({
      profile: { username: 'nike' },
      topReelUrls: [
        'https://www.instagram.com/nike/reel/AAA111/',
        'https://www.instagram.com/nike/reel/AAA111',
      ],
      topPostUrls: ['https://www.instagram.com/nike/p/BBB222/'],
      topPosts: [{ postUrl: 'https://www.instagram.com/nike/p/BBB222/' }],
      meta: { capturedAt: '2026-02-27T01:01:53.978Z' },
    });

    expect(data.profile.username).toBe('nike');
    expect(data.postUrls).toEqual([
      'https://www.instagram.com/nike/reel/AAA111/',
      'https://www.instagram.com/nike/p/BBB222/',
    ]);
  });
});

describe('url validation and media mapping', () => {
  it('validates instagram post urls', () => {
    expect(isValidInstagramPostUrl('https://www.instagram.com/nike/p/ABC123/')).toBe(true);
    expect(isValidInstagramPostUrl('https://www.instagram.com/nike/reel/ABC123/')).toBe(true);
    expect(isValidInstagramPostUrl('https://example.com/p/ABC123/')).toBe(false);
    expect(isValidInstagramPostUrl('https://www.instagram.com/nike/')).toBe(false);
  });

  it('maps carousel mixed media', () => {
    const entries = mapMediaEntries({
      media_type: 8,
      pk: '1',
      id: '2',
      code: 'CAROUSEL1',
      product_type: 'carousel_container',
      user: { username: 'nike' },
      carousel_media: [
        {
          media_type: 1,
          image_versions2: { candidates: [{ url: 'https://cdn/img1.jpg', width: 1080, height: 1080 }] },
        },
        {
          media_type: 2,
          image_versions2: { candidates: [{ url: 'https://cdn/cover2.jpg', width: 1080, height: 1080 }] },
          video_versions: [{ url: 'https://cdn/v2.mp4', width: 720, height: 1280 }],
        },
      ],
    }, 'https://www.instagram.com/nike/p/CAROUSEL1/', { includeCover: true });

    expect(entries.length).toBe(3);
    expect(entries.some((e) => e.kind === 'carousel_image')).toBe(true);
    expect(entries.some((e) => e.kind === 'carousel_video')).toBe(true);
    expect(entries.some((e) => e.kind === 'carousel_cover')).toBe(true);
  });

  it('builds deterministic filename', () => {
    const file = buildFilename(7, {
      shortcode: 'DUWEAjPj52d',
      kind: 'video',
      index: 1,
      ext: 'mp4',
    });
    expect(file).toBe('007_DUWEAjPj52d_video_1.mp4');
  });
});

describe('parsePort', () => {
  it('parses valid and invalid ports', () => {
    expect(parsePort('9222', null)).toBe(9222);
    expect(parsePort('0', 9222)).toBe(9222);
  });
});
