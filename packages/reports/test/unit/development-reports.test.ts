import { parseVisualSpec, visualPositionIssues } from '@atlasbi/contracts';
import { describe, expect, it } from 'vitest';

import { DEMO_REPORTS } from '../../src/index.ts';

describe.each(DEMO_REPORTS)('the demo report "$name"', (report) => {
  const visuals = report.pages.flatMap((page) => page.visuals);

  it('stores only the platform’s visual grammar, exactly as the grammar parses it', () => {
    for (const { spec } of visuals) {
      expect(parseVisualSpec(spec)).toEqual(spec);
    }
  });

  it('places every visual on the page grid without overlapping another', () => {
    const cells = new Set<string>();
    for (const { position } of visuals) {
      expect(visualPositionIssues(position)).toEqual([]);
      for (let x = position.x; x < position.x + position.width; x += 1) {
        for (let y = position.y; y < position.y + position.height; y += 1) {
          expect(cells.has(`${x},${y}`)).toBe(false);
          cells.add(`${x},${y}`);
        }
      }
    }
  });

  it('has a category a click can filter the other visuals by (docs/16, Capa 8)', () => {
    const filterable = visuals.filter(
      ({ spec }) => 'encoding' in spec && !('granularity' in spec.encoding),
    );
    expect(filterable.length).toBeGreaterThan(0);
    expect(visuals.length - filterable.length).toBeGreaterThanOrEqual(2);
  });
});
