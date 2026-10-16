import * as path from 'node:path';
import type { MissingPackagesSeverity } from '@texlance/core';

export interface TexlanceSettings {
  /** Absolute extra search roots. */
  extraPaths: string[];
  reportMissingPackages: MissingPackagesSeverity;
  kpsewhichPath: string | null;
  maxPreambleLines: number;
  completionEnabled: boolean;
}

export const DEFAULT_SETTINGS: TexlanceSettings = {
  extraPaths: [],
  reportMissingPackages: 'warning',
  kpsewhichPath: null,
  maxPreambleLines: 500,
  completionEnabled: true,
};

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

function normalizeSeverity(value: unknown): MissingPackagesSeverity {
  return value === 'none' || value === 'information' || value === 'warning' || value === 'error'
    ? value
    : DEFAULT_SETTINGS.reportMissingPackages;
}

/**
 * Normalises the raw `texlance.*` configuration document.
 *
 * Relative `extraPaths` entries are resolved against the workspace folder, the
 * same way `python.analysis.extraPaths` behaves.
 */
export function normalizeSettings(raw: unknown, rootPath: string | null): TexlanceSettings {
  const value = asRecord(raw);
  const analysis = asRecord(value.analysis);

  const rawExtraPaths = Array.isArray(analysis.extraPaths) ? analysis.extraPaths : [];
  const extraPaths: string[] = [];
  for (const entry of rawExtraPaths) {
    if (typeof entry !== 'string' || entry.trim().length === 0) {
      continue;
    }
    extraPaths.push(path.isAbsolute(entry) || !rootPath ? entry : path.resolve(rootPath, entry));
  }

  const rawMaxLines = asRecord(value.preamble).maxLines;
  const maxPreambleLines =
    typeof rawMaxLines === 'number' && Number.isFinite(rawMaxLines) && rawMaxLines > 0
      ? Math.floor(rawMaxLines)
      : DEFAULT_SETTINGS.maxPreambleLines;

  const rawKpsewhich = value.kpsewhichPath;

  return {
    extraPaths,
    reportMissingPackages: normalizeSeverity(analysis.reportMissingPackages),
    kpsewhichPath: typeof rawKpsewhich === 'string' && rawKpsewhich.trim().length > 0 ? rawKpsewhich : null,
    maxPreambleLines,
    completionEnabled:
      typeof asRecord(value.completion).enabled === 'boolean'
        ? (asRecord(value.completion).enabled as boolean)
        : DEFAULT_SETTINGS.completionEnabled,
  };
}
