'use strict';

const { buildCommand } = require('../../daemon/runner');

describe('daemon runner command builder', () => {
  it('builds search_users command with hard cap 5', () => {
    const spec = buildCommand('search_users', {
      query: 'dua lipa',
      limit: 20,
      output: './logs/dua-lipa-search.json',
      debugPort: 9333,
      keepConnected: true,
    });

    expect(spec.command).toBe('node');
    expect(spec.args).toEqual([
      'search-user.js',
      'dua lipa',
      '--limit', '5',
      '--output', './logs/dua-lipa-search.json',
      '--debug-port', '9333',
      '--keep-connected',
    ]);
  });

  it('uses default search_users limit 5 when not provided', () => {
    const spec = buildCommand('search_users', {
      query: 'nike',
    });

    expect(spec.command).toBe('node');
    expect(spec.args).toEqual([
      'search-user.js',
      'nike',
      '--limit', '5',
      '--debug-port', '9222',
    ]);
  });

  it('builds fetch_user_posts command', () => {
    const spec = buildCommand('fetch_user_posts', {
      target: 'nike',
      limit: 24,
      output: './logs/nike-posts.json',
      debugPort: 9333,
      keepConnected: true,
    });

    expect(spec.command).toBe('node');
    expect(spec.args).toEqual([
      'fetch-user-posts.js',
      'nike',
      '--limit', '24',
      '--output', './logs/nike-posts.json',
      '--debug-port', '9333',
      '--keep-connected',
    ]);
  });

  it('builds download_hot_media_assets command', () => {
    const spec = buildCommand('download_hot_media_assets', {
      input: './logs/nike-hot-media.json',
      outputDir: './downloads',
      concurrency: 2,
      retry: 3,
      timeout: 60000,
      proxy: 'http://127.0.0.1:7897',
      includeCover: false,
    });

    expect(spec.command).toBe('node');
    expect(spec.args).toContain('download-hot-media-assets.js');
    expect(spec.args).toContain('--input');
    expect(spec.args).toContain('./logs/nike-hot-media.json');
    expect(spec.args).toContain('--no-cover');
  });

  it('builds go_home command', () => {
    const spec = buildCommand('go_home', {
      targetUrl: 'https://www.instagram.com/',
      output: './logs/go-home.json',
      debugPort: 9333,
      keepConnected: true,
    });

    expect(spec.command).toBe('node');
    expect(spec.args).toEqual([
      'go-home.js',
      '--target-url', 'https://www.instagram.com/',
      '--output', './logs/go-home.json',
      '--debug-port', '9333',
      '--keep-connected',
    ]);
  });

  it('builds fetch_user_profile_summary command', () => {
    const spec = buildCommand('fetch_user_profile_summary', {
      target: 'nike',
      limit: 8,
      output: './logs/nike-profile-summary.json',
      debugPort: 9333,
      keepConnected: true,
    });

    expect(spec.command).toBe('node');
    expect(spec.args).toEqual([
      'fetch-user-profile-summary.js',
      'nike',
      '--limit', '8',
      '--output', './logs/nike-profile-summary.json',
      '--debug-port', '9333',
      '--keep-connected',
    ]);
  });

  it('builds fetch_user_hot_media command with fast mode flag', () => {
    const spec = buildCommand('fetch_user_hot_media', {
      target: 'nike',
      scanLimit: 8,
      topReels: 2,
      topPosts: 3,
      output: './logs/nike-hot-media.json',
      fast: true,
      debugPort: 9333,
    });

    expect(spec.command).toBe('node');
    expect(spec.args).toEqual([
      'fetch-user-hot-media.js',
      'nike',
      '--scan-limit', '8',
      '--top-reels', '2',
      '--top-posts', '3',
      '--output', './logs/nike-hot-media.json',
      '--debug-port', '9333',
      '--fast',
    ]);
  });

  it('builds search_content_local command', () => {
    const spec = buildCommand('search_content_local', {
      query: 'olympics',
      target: 'nike',
      mediaType: 'video',
      since: '2026-01-01',
      until: '2026-03-01',
      sort: 'recent',
      limit: 20,
      input: ['./logs/nike-posts-20.json', './logs/hot-comments-DVEQd9PjhJH-20.json'],
      indexFile: './.instagram-cli/cache/content-local-index.json',
      output: './logs/search-local-olympics.json',
      useIndexOnly: true,
      rebuildIndex: true,
    });

    expect(spec.command).toBe('node');
    expect(spec.args).toEqual([
      'search-content-local.js',
      'olympics',
      '--target', 'nike',
      '--media-type', 'video',
      '--since', '2026-01-01',
      '--until', '2026-03-01',
      '--sort', 'recent',
      '--limit', '20',
      '--index-file', './.instagram-cli/cache/content-local-index.json',
      '--output', './logs/search-local-olympics.json',
      '--input', './logs/nike-posts-20.json',
      '--input', './logs/hot-comments-DVEQd9PjhJH-20.json',
      '--use-index-only',
      '--rebuild-index',
    ]);
  });

  it('throws for missing required params', () => {
    expect(() => buildCommand('search_users', {})).toThrow(/query/);
    expect(() => buildCommand('fetch_user_posts', {})).toThrow(/target/);
    expect(() => buildCommand('fetch_user_profile_summary', {})).toThrow(/target/);
    expect(() => buildCommand('search_content_local', {})).toThrow(/query/);
    expect(() => buildCommand('download_hot_media_assets', {})).toThrow(/input/);
  });
});
