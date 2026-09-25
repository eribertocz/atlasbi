import { styleText } from 'node:util';

import type { CheckResult, CheckStatus } from '../checks/check-result.ts';
import type { ReadinessReport, ReadinessStatus } from '../health/readiness-chain.ts';
import { PRODUCT_DISPLAY_NAME } from '../product.ts';

const CHECK_MARKS: Record<CheckStatus, string> = {
  pass: styleText('green', '✓'),
  warn: styleText('yellow', '!'),
  fail: styleText('red', '✗'),
};

const READINESS_MARKS: Record<ReadinessStatus, string> = {
  ready: styleText('green', '✓'),
  failed: styleText('red', '✗'),
  skipped: styleText('gray', '-'),
};

export function printChecks(title: string, results: readonly CheckResult[]): void {
  const width = Math.max(...results.map((result) => result.name.length));
  console.log(`\n${styleText('bold', title)}`);
  for (const result of results) {
    console.log(`  ${CHECK_MARKS[result.status]} ${result.name.padEnd(width)}  ${result.detail}`);
    if (result.remedy !== undefined && result.status !== 'pass') {
      console.log(`    ${' '.repeat(width)}  → ${result.remedy}`);
    }
  }
}

export function printReadiness(report: ReadinessReport): void {
  const width = Math.max(...report.outcomes.map((outcome) => outcome.name.length));
  const title = report.ready
    ? styleText(['bold', 'green'], `${PRODUCT_DISPLAY_NAME} ✓`)
    : styleText(['bold', 'red'], `${PRODUCT_DISPLAY_NAME} ✗  not ready`);
  console.log(`\n${title}\n`);
  for (const outcome of report.outcomes) {
    console.log(
      `  ${READINESS_MARKS[outcome.status]} ${outcome.name.padEnd(width)}  ${outcome.detail}`,
    );
  }
}
