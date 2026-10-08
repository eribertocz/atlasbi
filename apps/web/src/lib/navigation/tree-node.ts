import type { LucideIcon } from '@lucide/svelte';

/** One entry of the sidebar tree (docs/08 §11.3): a place to go, and what is under it. */
export interface TreeNode {
  id: string;
  label: string;
  href?: string;
  icon?: LucideIcon;
  /** The page shown now is this entry. */
  active?: boolean;
  children?: readonly TreeNode[];
}
