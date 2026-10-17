import { describeToolConfinement } from '@atlasbi/contracts-testing';

// The extraction tool is this package's business (docs/21 §2.4, §3): no other layer names it, so
// replacing it touches this package alone.
describeToolConfinement({
  tool: 'dlt',
  pattern: /dlt/i,
  ownerPackage: 'packages/ingestion',
  // Decision D2: two guards that exist to stop the tool's metadata, and their tests. Changing the
  // tool means updating both guards and this list.
  knownExceptions: {
    'packages/contracts/src/data/data-contract.ts':
      "Guard: a data contract rejects the tool's columns.",
    'packages/contracts/test/unit/data-contract.test.ts': 'The test of that guard.',
    'packages/transform/project/linter/platform_rules.py':
      "Guard: the transformation's lint rule rejects the tool's columns and datasets.",
    'packages/transform/test/unit/transform-project.test.ts': 'The test of that guard.',
  },
});
