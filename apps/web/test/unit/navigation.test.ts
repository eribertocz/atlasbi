import { describe, expect, it } from 'vitest';

import { Navigation } from '../../src/lib/navigation/navigation.svelte.ts';

const COMERCIAL = {
  workspaceId: 'w1',
  slug: 'comercial',
  name: 'Comercial',
  role: 'admin' as const,
};
const FINANZAS = { workspaceId: 'w2', slug: 'finanzas', name: 'Finanzas', role: 'viewer' as const };

describe('the navigation of the sidebar', () => {
  it('lists each workspace with its reports, even when one list fails', async () => {
    const navigation = new Navigation({
      workspaces: () => Promise.resolve([COMERCIAL, FINANZAS]),
      reports: (workspaceId) =>
        workspaceId === 'w1'
          ? Promise.resolve([{ id: 'r1', name: 'Ventas' }])
          : Promise.reject(new Error('unavailable')),
    });

    await navigation.load();

    expect(navigation.status).toBe('ready');
    expect(navigation.workspace('comercial')).toEqual({
      ...COMERCIAL,
      reports: [{ id: 'r1', name: 'Ventas' }],
      reportsFailed: false,
    });
    expect(navigation.workspace('finanzas')).toEqual({
      ...FINANZAS,
      reports: [],
      reportsFailed: true,
    });
    expect(navigation.workspace('marketing')).toBeUndefined();
  });

  it('says it failed when the workspaces cannot be listed, and forgets everything on reset', async () => {
    const navigation = new Navigation({
      workspaces: () => Promise.reject(new Error('unavailable')),
      reports: () => Promise.resolve([]),
    });

    await navigation.load();
    expect(navigation.status).toBe('failed');

    navigation.reset();
    expect(navigation.status).toBe('idle');
    expect(navigation.workspaces).toEqual([]);
  });
});
