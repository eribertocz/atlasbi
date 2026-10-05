import salesOrdersMartV1 from '../../data/mart.sales_orders.v1.json' with { type: 'json' };
import developmentSalesOrdersV1 from '../../data/source.development_sales_orders.v1.json' with { type: 'json' };
import { type DataContract, majorVersion, parseDataContract } from './data-contract.ts';

/** Every contract file, validated when the module loads: an invalid file fails every consumer. */
const CONTRACTS: readonly DataContract[] = [developmentSalesOrdersV1, salesOrdersMartV1].map(
  (file) => parseDataContract(file),
);

export class UnknownDataContractError extends Error {
  constructor(id: string, major: number) {
    super(`No data contract ${id} with major version ${major}.`);
    this.name = 'UnknownDataContractError';
  }
}

/** The contract a producer publishes or a consumer reads, pinned to its major version. */
export function getDataContract(id: string, major: number): DataContract {
  const contract = CONTRACTS.find(
    (candidate) => candidate.id === id && majorVersion(candidate) === major,
  );
  if (contract === undefined) {
    throw new UnknownDataContractError(id, major);
  }
  return contract;
}

export function listDataContracts(): readonly DataContract[] {
  return CONTRACTS;
}
