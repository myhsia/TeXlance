import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, normalizeSettings } from '../../server/src/settings';

describe('normalizeSettings', () => {
  it('falls back to defaults', () => {
    expect(normalizeSettings(undefined, null)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings({}, null)).toEqual(DEFAULT_SETTINGS);
  });

  it('resolves relative extra paths against the workspace folder', () => {
    const settings = normalizeSettings({ analysis: { extraPaths: ['patha', '/absolute/pathb'] } }, '/workspace');
    expect(settings.extraPaths).toEqual([path.resolve('/workspace', 'patha'), '/absolute/pathb']);
  });

  it('keeps relative extra paths untouched without a workspace folder', () => {
    const settings = normalizeSettings({ analysis: { extraPaths: ['patha'] } }, null);
    expect(settings.extraPaths).toEqual(['patha']);
  });

  it('drops blank extra path entries', () => {
    const settings = normalizeSettings({ analysis: { extraPaths: ['', '   ', 'ok'] } }, null);
    expect(settings.extraPaths).toEqual(['ok']);
  });

  it('normalizes the diagnostic severity', () => {
    expect(normalizeSettings({ analysis: { reportMissingPackages: 'error' } }, null).reportMissingPackages).toBe('error');
    expect(normalizeSettings({ analysis: { reportMissingPackages: 'nonsense' } }, null).reportMissingPackages).toBe(
      'warning',
    );
  });

  it('normalizes the preamble line limit', () => {
    expect(normalizeSettings({ preamble: { maxLines: 200 } }, null).maxPreambleLines).toBe(200);
    expect(normalizeSettings({ preamble: { maxLines: -1 } }, null).maxPreambleLines).toBe(
      DEFAULT_SETTINGS.maxPreambleLines,
    );
  });

  it('treats a blank kpsewhich path as auto detection', () => {
    expect(normalizeSettings({ kpsewhichPath: '   ' }, null).kpsewhichPath).toBeNull();
    expect(normalizeSettings({ kpsewhichPath: '/usr/bin/kpsewhich' }, null).kpsewhichPath).toBe('/usr/bin/kpsewhich');
  });

  it('honours the completion toggle', () => {
    expect(normalizeSettings({ completion: { enabled: false } }, null).completionEnabled).toBe(false);
    expect(normalizeSettings({}, null).completionEnabled).toBe(true);
  });
});
