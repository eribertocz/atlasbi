import type { VisualSpec } from './visual-spec.ts';

/**
 * The Report Document (docs/19 §8, docs/21 §9): what a report is for the platform — never the rows
 * that store it, nor what an API sends. `report` → `page` → `visual`, in the order they are shown.
 */
export const REPORT_SCHEMA_VERSION = 1;

/** A page is a grid this many cells wide; a visual's position is counted in cells. */
export const REPORT_GRID_COLUMNS = 12;

export interface VisualPosition {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ReportVisual {
  id: string;
  position: VisualPosition;
  spec: VisualSpec;
  /** Optimistic concurrency (docs/14 §2.2): a change names the version it was made on. */
  version: number;
}

export interface ReportPage {
  id: string;
  name: string;
  visuals: readonly ReportVisual[];
}

export interface ReportDocument {
  id: string;
  workspaceId: string;
  name: string;
  /** The Report Document version it was saved with (docs/21 §2.3). */
  schemaVersion: number;
  pages: readonly ReportPage[];
}

/** A report as a list shows it: enough to open it. */
export interface ReportSummary {
  id: string;
  name: string;
}

/** What is wrong with a position on the grid; nothing when it fits. */
export function visualPositionIssues(position: VisualPosition): string[] {
  const issues: string[] = [];
  const { x, y, width, height } = position;
  if (![x, y].every((value) => Number.isInteger(value) && value >= 0)) {
    issues.push('x and y are whole cells from 0');
  }
  if (![width, height].every((value) => Number.isInteger(value) && value >= 1)) {
    issues.push('width and height are whole cells from 1');
  }
  if (x + width > REPORT_GRID_COLUMNS) {
    issues.push(`a visual ends within the ${REPORT_GRID_COLUMNS} columns of the page`);
  }
  return issues;
}
