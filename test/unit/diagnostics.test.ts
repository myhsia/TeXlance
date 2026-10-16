import { describe, expect, it } from 'vitest';
import { DiagnosticSeverity } from 'vscode-languageserver-types';
import {
  DIAGNOSTIC_SOURCE,
  REPORT_MISSING_PACKAGES,
  buildDiagnostics,
  missingResourceMessage,
  severityFromString,
} from '@texlance/core';
import type { NameReference, Resolution } from '@texlance/core';

function reference(name: string, kind: 'package' | 'class'): NameReference {
  return {
    name,
    kind,
    extension: kind === 'class' ? 'cls' : 'sty',
    command: kind === 'class' ? 'documentclass' : 'usepackage',
    range: { start: { line: 2, character: 12 }, end: { line: 2, character: 12 + name.length } },
    argumentRange: { start: { line: 2, character: 11 }, end: { line: 2, character: 12 + name.length } },
  };
}

const resolution = new Map<string, Resolution>([['amsmath.sty', { path: '/texlive/amsmath.sty', origin: 'kpse' }]]);

describe('missingResourceMessage', () => {
  it('uses the Pylance-style phrasing', () => {
    expect(missingResourceMessage('foo', 'package')).toBe('Load the "foo" package could not be resolved');
    expect(missingResourceMessage('bar', 'class')).toBe('Load the "bar" class could not be resolved');
  });
});

describe('severityFromString', () => {
  it('maps the configured levels', () => {
    expect(severityFromString('error')).toBe(DiagnosticSeverity.Error);
    expect(severityFromString('information')).toBe(DiagnosticSeverity.Information);
    expect(severityFromString('warning')).toBe(DiagnosticSeverity.Warning);
    expect(severityFromString('none')).toBe(DiagnosticSeverity.Warning);
  });
});

describe('buildDiagnostics', () => {
  it('reports only unresolved resources', () => {
    const refs = [reference('amsmath', 'package'), reference('ghost', 'package')];
    const diagnostics = buildDiagnostics(refs, resolution, DiagnosticSeverity.Warning);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toEqual({
      range: refs[1].range,
      severity: DiagnosticSeverity.Warning,
      source: DIAGNOSTIC_SOURCE,
      code: REPORT_MISSING_PACKAGES,
      message: 'Load the "ghost" package could not be resolved',
    });
  });

  it('reports an unresolvable document class', () => {
    const refs = [reference('unknownclass', 'class')];
    const diagnostics = buildDiagnostics(refs, new Map(), DiagnosticSeverity.Error);
    expect(diagnostics[0]?.message).toBe('Load the "unknownclass" class could not be resolved');
    expect(diagnostics[0]?.severity).toBe(DiagnosticSeverity.Error);
    expect(diagnostics[0]?.code).toBe('reportMissingPackages');
  });
});
