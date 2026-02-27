'use strict';

const {
  parseCliArgs,
  isReelPost,
  computeMediaHotScore,
  rankHotMedia,
} = require('../../fetch-user-hot-media');

describe('fetch-user-hot-media cli parsing', () => {
  it('parses target and options', () => {
    const args = parseCliArgs([
      'nike',
      '--scan-limit', '120',
      '--top-reels', '8',
      '--top-posts', '6',
      '--output', './logs/nike-hot.json',
      '--debug-port', '9333',
      '--keep-connected',
    ]);

    expect(args.error).toBe('');
    expect(args.target).toBe('nike');
    expect(args.scanLimit).toBe(120);
    expect(args.topReels).toBe(8);
    expect(args.topPosts).toBe(6);
    expect(args.output).toBe('./logs/nike-hot.json');
    expect(args.debugPort).toBe(9333);
    expect(args.keepConnected).toBe(true);
  });

  it('rejects invalid numeric options and unknown options', () => {
    expect(parseCliArgs(['nike', '--scan-limit', '0']).error).toContain('scan-limit');
    expect(parseCliArgs(['nike', '--top-reels', '0']).error).toContain('top-reels');
    expect(parseCliArgs(['nike', '--top-posts', '0']).error).toContain('top-posts');
    expect(parseCliArgs(['nike', '--bad']).error).toContain('未知参数');
  });
});

describe('isReelPost', () => {
  it('detects reels by productType or url', () => {
    expect(isReelPost({ productType: 'clips' })).toBe(true);
    expect(isReelPost({ postUrl: 'https://www.instagram.com/nike/reel/ABC123/' })).toBe(true);
    expect(isReelPost({ productType: 'feed', postUrl: 'https://www.instagram.com/nike/p/ABC123/' })).toBe(false);
  });
});

describe('computeMediaHotScore and ranking', () => {
  it('score increases with engagement', () => {
    const now = 2000000000;
    const low = {
      likeCount: 10,
      commentCount: 1,
      viewCount: 100,
      playCount: 0,
      takenAtUnix: now - 3600,
    };
    const high = {
      likeCount: 100,
      commentCount: 5,
      viewCount: 1000,
      playCount: 0,
      takenAtUnix: now - 3600,
    };

    expect(computeMediaHotScore(high, now)).toBeGreaterThan(computeMediaHotScore(low, now));
  });

  it('ranks by score desc', () => {
    const now = 2000000000;
    const ranked = rankHotMedia([
      {
        shortcode: 'A',
        postUrl: 'https://www.instagram.com/p/A/',
        likeCount: 50,
        commentCount: 1,
        viewCount: 200,
        takenAtUnix: now - 3600,
      },
      {
        shortcode: 'B',
        postUrl: 'https://www.instagram.com/p/B/',
        likeCount: 200,
        commentCount: 3,
        viewCount: 1000,
        takenAtUnix: now - 3600,
      },
    ], now);

    expect(ranked[0].shortcode).toBe('B');
    expect(ranked[0].rank).toBe(1);
  });
});
