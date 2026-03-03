'use strict';

const { buildCommand } = require('../../daemon/runner');

describe('daemon runner command builder', () => {
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

  it('throws for missing required params', () => {
    expect(() => buildCommand('search_users', {})).toThrow(/query/);
    expect(() => buildCommand('fetch_user_posts', {})).toThrow(/target/);
    expect(() => buildCommand('download_hot_media_assets', {})).toThrow(/input/);
  });
});
