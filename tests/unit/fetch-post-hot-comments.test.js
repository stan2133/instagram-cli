'use strict';

const {
  parsePort,
  parseCliArgs,
  normalizePostTarget,
  computeHotScore,
  normalizeComment,
  rankHotComments,
} = require('../../fetch-post-hot-comments');

describe('fetch-post-hot-comments cli parsing', () => {
  it('parses target and options', () => {
    const args = parseCliArgs([
      'https://www.instagram.com/p/ABC123xyz89/',
      '--limit', '50',
      '--min-likes', '12',
      '--include-replies',
      '--output', './logs/hot.json',
      '--debug-port', '9333',
      '--keep-connected',
    ]);

    expect(args.error).toBe('');
    expect(args.target).toBe('https://www.instagram.com/p/ABC123xyz89/');
    expect(args.limit).toBe(50);
    expect(args.minLikes).toBe(12);
    expect(args.includeReplies).toBe(true);
    expect(args.output).toBe('./logs/hot.json');
    expect(args.debugPort).toBe(9333);
    expect(args.keepConnected).toBe(true);
  });

  it('rejects invalid limit/min-likes/unknown', () => {
    expect(parseCliArgs(['ABC123', '--limit', '0']).error).toContain('limit');
    expect(parseCliArgs(['ABC123', '--min-likes', '-1']).error).toContain('min-likes');
    expect(parseCliArgs(['ABC123', '--bad']).error).toContain('未知参数');
  });
});

describe('normalizePostTarget', () => {
  it('supports shortcode input', () => {
    expect(normalizePostTarget('DVEQd9PjhJH')).toEqual({
      shortcode: 'DVEQd9PjhJH',
      postType: 'p',
      postUrl: 'https://www.instagram.com/p/DVEQd9PjhJH/',
    });
  });

  it('supports post/reel urls', () => {
    expect(normalizePostTarget('https://www.instagram.com/p/DVEQd9PjhJH/')).toEqual({
      shortcode: 'DVEQd9PjhJH',
      postType: 'p',
      postUrl: 'https://www.instagram.com/p/DVEQd9PjhJH/',
    });
    expect(normalizePostTarget('https://www.instagram.com/nike/reel/DUQoGM4juNA/')).toEqual({
      shortcode: 'DUQoGM4juNA',
      postType: 'reel',
      postUrl: 'https://www.instagram.com/reel/DUQoGM4juNA/',
    });
  });

  it('rejects non-instagram or invalid post path', () => {
    expect(normalizePostTarget('https://example.com/p/xx')).toHaveProperty('error');
    expect(normalizePostTarget('https://www.instagram.com/nike/')).toHaveProperty('error');
  });
});

describe('normalizeComment and ranking', () => {
  it('normalizes comment fields and replies', () => {
    const raw = {
      pk: '1',
      text: 'hello',
      comment_like_count: 20,
      child_comment_count: 2,
      created_at: 1700000000,
      is_ranked_comment: true,
      user: {
        pk: '999',
        username: 'nike',
        is_verified: true,
      },
      preview_child_comments: [
        {
          pk: '2',
          text: 'reply',
          comment_like_count: 1,
          created_at: 1700000100,
          user: { username: 'u1', is_verified: false },
        },
      ],
    };

    const item = normalizeComment(raw, 'nike', '999', true, 1);
    expect(item.commentPk).toBe('1');
    expect(item.replyCount).toBe(2);
    expect(item.ownerIsPostAuthor).toBe(true);
    expect(item.ownerIsVerified).toBe(true);
    expect(item.isRankedComment).toBe(true);
    expect(item.replies).toHaveLength(1);
    expect(Number.isFinite(item.score)).toBe(true);
  });

  it('ranks by score desc then like count', () => {
    const now = 2000000000;
    const a = {
      likeCount: 10,
      replyCount: 0,
      isRankedComment: false,
      ownerIsVerified: false,
      ownerIsPostAuthor: false,
      apiRank: 10,
      createdAtUnix: now - 3600,
    };
    const b = {
      likeCount: 100,
      replyCount: 0,
      isRankedComment: false,
      ownerIsVerified: false,
      ownerIsPostAuthor: false,
      apiRank: 20,
      createdAtUnix: now - 3600,
    };
    a.score = computeHotScore(a, now);
    b.score = computeHotScore(b, now);
    const ranked = rankHotComments([{ ...a }, { ...b }]);
    expect(ranked[0].likeCount).toBe(100);
    expect(ranked[0].rank).toBe(1);
  });
});

describe('parsePort', () => {
  it('parses valid port and fallback', () => {
    expect(parsePort('9222', null)).toBe(9222);
    expect(parsePort('0', 9222)).toBe(9222);
  });
});
