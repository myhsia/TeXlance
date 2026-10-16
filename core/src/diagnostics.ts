import type { Diagnostic } from 'vscode-languageserver-types';
import { DiagnosticSeverity } from 'vscode-languageserver-types';
import type { NameReference, ResourceKind } from './preamble';
import type { Resolution } from './resolve';
import { fileNameOf } from './resolve';

/** Diagnostic code, rendered by VS Code as `TeXlance(reportMissingPackages)`. */
export const REPORT_MISSING_PACKAGES = 'reportMissingPackages';

export const DIAGNOSTIC_SOURCE = 'TeXlance';

export type MissingPackagesSeverity = 'none' | 'information' | 'warning' | 'error';

export function severityFromString(value: MissingPackagesSeverity): DiagnosticSeverity {
  switch (value) {
    case 'error':
      return DiagnosticSeverity.Error;
    case 'information':
      return DiagnosticSeverity.Information;
    default:
      return DiagnosticSeverity.Warning;
  }
}

export function missingResourceMessage(name: string, kind: ResourceKind): string {
  return `Load the "${name}" ${kind} could not be resolved`;
}

/**
 * Turns unresolved preamble references into diagnostics.
 *
 * `resolution` is keyed by file name (e.g. `amsmath.sty`); any reference whose
 * file is absent was not found by kpsewhich, an extra path, or the workspace.
 */
export function buildDiagnostics(
  refs: NameReference[],
  resolution: Map<string, Resolution>,
  severity: DiagnosticSeverity,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  for (const ref of refs) {
    if (resolution.has(fileNameOf(ref.name, ref.kind))) {
      continue;
    }
    diagnostics.push({
      range: ref.range,
      severity,
      source: DIAGNOSTIC_SOURCE,
      code: REPORT_MISSING_PACKAGES,
      message: missingResourceMessage(ref.name, ref.kind),
    });
  }
  return diagnostics;
}
