import type { SemanticFilter } from '@atlasbi/contracts';

import type { ReportFilter } from './filter-ast.ts';

/**
 * What someone selected while looking at a report (docs/14 §1.2): ephemeral, in this tab only —
 * never the filters an author saves with the report. First cut of docs/14: cross-filter only; the
 * drill path and the rest arrive with the Interaction Engine of build step 9.
 */
export class InteractionState {
  activeFilters = $state<ReportFilter[]>([]);

  /** One filter per member: a new one replaces the previous filter on that member. */
  applyFilter(filter: ReportFilter): void {
    this.activeFilters = [
      ...this.activeFilters.filter((active) => active.member !== filter.member),
      filter,
    ];
  }

  clearFilter(member: string): void {
    this.activeFilters = this.activeFilters.filter((active) => active.member !== member);
  }

  /** What filters a visual's query: every active filter except the ones it made itself. */
  filtersFor(visualId: string): SemanticFilter[] {
    return this.activeFilters
      .filter((filter) => filter.sourceVisualId !== visualId)
      .map(({ member, operator, values }) => ({ member, operator, values }));
  }

  /** The value a visual has selected on a member, while its selection filters the others. */
  selectionOf(visualId: string, member: string): string | undefined {
    const filter = this.activeFilters.find(
      (active) =>
        active.sourceVisualId === visualId &&
        active.member === member &&
        active.operator === 'equals',
    );
    return filter?.values[0];
  }

  /** A click on a category: selects it, or clears the selection when it was the selected one. */
  toggleSelection(visualId: string, member: string, value: string): void {
    if (this.selectionOf(visualId, member) === value) {
      this.clearFilter(member);
    } else {
      this.applyFilter({ member, operator: 'equals', values: [value], sourceVisualId: visualId });
    }
  }
}
