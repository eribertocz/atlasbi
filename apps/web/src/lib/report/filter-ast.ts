import type { SemanticFilter } from '@atlasbi/contracts';

/**
 * A filter of the Interaction Engine (docs/14 §1.1): the Filter AST the semantic layer already
 * takes — member, operator, values — so it travels to the query unchanged, plus the visual a
 * selection came from, so a cross-filter never filters the visual that made it. docs/14 calls it
 * `DashboardFilter`; the platform says "report" (docs/19 §8.2).
 */
export interface ReportFilter extends SemanticFilter {
  sourceVisualId?: string;
}
