'use strict';

const {
  parsePort,
  parseCliArgs,
  normalizeTarget,
  normalizeFollowingUser,
} = require('../../fetch-user-following');

describe('fetch-user-following cli parsing', () => {
  it('parses target and options', () => {
    const args = parseCliArgs([
      'https://www.instagram.com/nike/',
      '--limit', '150',
      '--output', './logs/nike-following.json',
      '--debug-port', '9333',
      '--keep-connected',
    ]);

    expect(args.error).toBe('');
    expect(args.target).toBe('https://www.instagram.com/nike/');
    expect(args.limit).toBe(150);
    expect(args.output).toBe('./logs/nike-following.json');
    expect(args.debugPort).toBe(9333);
    expect(args.keepConnected).toBe(true);
  });

  it('rejects invalid limit and unknown options', () => {
    expect(parseCliArgs(['nike', '--limit', '0']).error).toContain('limit');
    expect(parseCliArgs(['nike', '--bad']).error).toContain('未知参数');
  });
});

describe('normalizeTarget', () => {
  it('accepts username, @username and profile url', () => {
    expect(normalizeTarget('nike')).toEqual({
      username: 'nike',
      profileUrl: 'https://www.instagram.com/nike/',
    });

    expect(normalizeTarget('@nike')).toEqual({
      username: 'nike',
      profileUrl: 'https://www.instagram.com/nike/',
    });

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

describe('normalizeFollowingUser', () => {
  it('normalizes following item fields', () => {
    const user = normalizeFollowingUser({
      pk: '123',
      username: 'abc',
      full_name: 'ABC',
      is_private: true,
      is_verified: false,
      profile_pic_url: 'https://img',
      friendship_status: {
        followed_by: true,
        following: false,
        outgoing_request: true,
      },
    });

    expect(user.id).toBe('123');
    expect(user.username).toBe('abc');
    expect(user.profileUrl).toBe('https://www.instagram.com/abc/');
    expect(user.isPrivate).toBe(true);
    expect(user.followsViewer).toBe(true);
    expect(user.followedByViewer).toBe(false);
    expect(user.hasRequestedByViewer).toBe(true);
  });
});

describe('parsePort', () => {
  it('parses valid port and fallback', () => {
    expect(parsePort('9222', null)).toBe(9222);
    expect(parsePort('0', 9222)).toBe(9222);
  });
});
