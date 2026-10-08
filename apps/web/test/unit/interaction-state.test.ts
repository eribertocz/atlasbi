import { describe, expect, it } from 'vitest';

import { InteractionState } from '../../src/lib/report/interaction-state.svelte.ts';

const REGION = 'sales_orders.region';
const CATEGORY = 'sales_orders.product_category';

describe('the interaction state of a report (docs/14 §1.2, first cut)', () => {
  it('filters every visual but the one whose selection made the filter', () => {
    const interaction = new InteractionState();

    interaction.toggleSelection('bar', REGION, 'North');

    expect(interaction.filtersFor('kpi')).toEqual([
      { member: REGION, operator: 'equals', values: ['North'] },
    ]);
    expect(interaction.filtersFor('bar')).toEqual([]);
    expect(interaction.selectionOf('bar', REGION)).toBe('North');
    expect(interaction.selectionOf('kpi', REGION)).toBeUndefined();
  });

  it('keeps one filter per member: a new selection replaces the previous one', () => {
    const interaction = new InteractionState();

    interaction.toggleSelection('bar', REGION, 'North');
    interaction.toggleSelection('bar', REGION, 'South');

    expect(interaction.activeFilters).toEqual([
      { member: REGION, operator: 'equals', values: ['South'], sourceVisualId: 'bar' },
    ]);
  });

  it('clears a selection when the same category is clicked again', () => {
    const interaction = new InteractionState();

    interaction.toggleSelection('bar', REGION, 'North');
    interaction.toggleSelection('bar', REGION, 'North');

    expect(interaction.activeFilters).toEqual([]);
  });

  it('combines selections from two visuals, each filtering the other', () => {
    const interaction = new InteractionState();

    interaction.toggleSelection('regions', REGION, 'North');
    interaction.toggleSelection('categories', CATEGORY, 'Books');

    expect(interaction.filtersFor('regions')).toEqual([
      { member: CATEGORY, operator: 'equals', values: ['Books'] },
    ]);
    expect(interaction.filtersFor('categories')).toEqual([
      { member: REGION, operator: 'equals', values: ['North'] },
    ]);
    expect(interaction.filtersFor('line')).toHaveLength(2);

    interaction.clearFilter(REGION);
    expect(interaction.filtersFor('line')).toEqual([
      { member: CATEGORY, operator: 'equals', values: ['Books'] },
    ]);
  });
});
