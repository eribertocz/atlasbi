import { describeToolConfinement } from '@atlasbi/contracts-testing';

// The transformation tool is this package's business (docs/21 §2.4, §3): no other layer names it —
// Airflow, CI and the studios call `pnpm transform <verb>` — so replacing it touches this package
// alone.
describeToolConfinement({
  tool: 'SQLMesh',
  pattern: /sqlmesh/i,
  ownerPackage: 'packages/transform',
  knownExceptions: {
    'tools/platform-cli/test/unit/transform-command.test.ts':
      'Guard: what `pnpm transform` prints never names the tool.',
  },
});
