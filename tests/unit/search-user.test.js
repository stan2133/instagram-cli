'use strict';

const {
  parseCliArgs,
  isProfilePath,
  normalizeExtractedUsers,
  pickTargetUser,
  parsePort,
} = require('../../search-user');

describe('search-user cli parsing', () => {
  it('parses query and options', () => {
    const args = parseCliArgs([
      'coco',
      '--limit', '20',
      '--output', './tmp/results.json',
      '--debug-port', '9333',
      '--keep-connected',
    ]);

    expect(args.error).toBe('');
    expect(args.query).toBe('coco');
    expect(args.limit).toBe(20);
    expect(args.output).toBe('./tmp/results.json');
    expect(args.debugPort).toBe(9333);
    expect(args.keepConnected).toBe(true);
  });

  it('rejects invalid limit', () => {
    const args = parseCliArgs(['coco', '--limit', '0']);
    expect(args.error).toContain('limit');
  });

  it('rejects unknown option', () => {
    const args = parseCliArgs(['coco', '--bad-option']);
    expect(args.error).toContain('未知参数');
  });

  it('parses open option', () => {
    const args = parseCliArgs(['coco', '--open', '2']);
    expect(args.error).toBe('');
    expect(args.open).toBe('2');
  });
});

describe('search-user profile path matcher', () => {
  it('accepts valid profile href', () => {
    expect(isProfilePath('/nike/')).toBe('nike');
    expect(isProfilePath('/john.doe_1/')).toBe('john.doe_1');
  });

  it('rejects reserved and invalid href', () => {
    expect(isProfilePath('/explore/')).toBeNull();
    expect(isProfilePath('/reels/abc/')).toBeNull();
    expect(isProfilePath('https://instagram.com/nike/')).toBeNull();
  });
});

describe('search-user normalize users', () => {
  it('dedupes and limits users', () => {
    const users = normalizeExtractedUsers([
      { username: 'nike', displayName: 'Nike', profileUrl: 'https://www.instagram.com/nike/' },
      { username: 'NIKE', displayName: 'Nike dup', profileUrl: 'https://www.instagram.com/NIKE/' },
      { username: 'adidas', displayName: 'Adidas', profileUrl: 'https://www.instagram.com/adidas/' },
    ], 2);

    expect(users).toHaveLength(2);
    expect(users[0].username).toBe('nike');
    expect(users[1].username).toBe('adidas');
  });

  it('fills defaults for missing fields', () => {
    const users = normalizeExtractedUsers([{ username: 'puma' }], 10);

    expect(users[0]).toEqual({
      username: 'puma',
      displayName: 'puma',
      profileUrl: 'https://www.instagram.com/puma/',
      fullName: '',
      avatarUrl: '',
      isVerified: false,
    });
  });
});

describe('parsePort', () => {
  it('parses valid port', () => {
    expect(parsePort('9222', null)).toBe(9222);
  });

  it('returns fallback for invalid port', () => {
    expect(parsePort('0', 9222)).toBe(9222);
    expect(parsePort('abc', 9222)).toBe(9222);
  });
});

describe('pickTargetUser', () => {
  const users = [
    { username: 'cocogauff', profileUrl: 'https://www.instagram.com/cocogauff/' },
    { username: 'coco_hu1029', profileUrl: 'https://www.instagram.com/coco_hu1029/' },
  ];

  it('picks by index (1-based)', () => {
    expect(pickTargetUser(users, '2')).toEqual(users[1]);
  });

  it('picks by username', () => {
    expect(pickTargetUser(users, 'cocogauff')).toEqual(users[0]);
    expect(pickTargetUser(users, '@COCO_HU1029')).toEqual(users[1]);
  });

  it('returns null when no match', () => {
    expect(pickTargetUser(users, '99')).toBeNull();
    expect(pickTargetUser(users, 'nobody')).toBeNull();
  });
});
