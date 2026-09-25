import type {
  LogicalType,
  QueryColumn,
  QueryParameter,
  QueryResult,
  QueryValue,
} from '@atlasbi/contracts';
import { LakehouseError } from '@atlasbi/contracts';
import {
  DuckDBBlobValue,
  DuckDBTimestampTZValue,
  DuckDBTimestampValue,
  DuckDBTypeId,
  JsonDuckDBValueConverter,
  type DuckDBPreparedStatement,
  type DuckDBResultReader,
  type DuckDBType,
  type DuckDBValueConverter,
  type Json,
} from '@duckdb/node-api';

const LOGICAL_KINDS_BY_TYPE_ID: Partial<Record<DuckDBTypeId, LogicalType>> = {
  [DuckDBTypeId.BOOLEAN]: { kind: 'boolean' },
  [DuckDBTypeId.TINYINT]: { kind: 'int8' },
  [DuckDBTypeId.SMALLINT]: { kind: 'int16' },
  [DuckDBTypeId.INTEGER]: { kind: 'int32' },
  [DuckDBTypeId.BIGINT]: { kind: 'int64' },
  [DuckDBTypeId.HUGEINT]: { kind: 'int128' },
  [DuckDBTypeId.UTINYINT]: { kind: 'uint8' },
  [DuckDBTypeId.USMALLINT]: { kind: 'uint16' },
  [DuckDBTypeId.UINTEGER]: { kind: 'uint32' },
  [DuckDBTypeId.UBIGINT]: { kind: 'uint64' },
  [DuckDBTypeId.UHUGEINT]: { kind: 'uint128' },
  [DuckDBTypeId.FLOAT]: { kind: 'float32' },
  [DuckDBTypeId.DOUBLE]: { kind: 'float64' },
  [DuckDBTypeId.VARCHAR]: { kind: 'varchar' },
  [DuckDBTypeId.ENUM]: { kind: 'varchar' },
  [DuckDBTypeId.UUID]: { kind: 'uuid' },
  [DuckDBTypeId.BLOB]: { kind: 'blob' },
  [DuckDBTypeId.DATE]: { kind: 'date' },
  [DuckDBTypeId.TIME]: { kind: 'time' },
  [DuckDBTypeId.TIME_NS]: { kind: 'time' },
  [DuckDBTypeId.TIMESTAMP]: { kind: 'timestamp' },
  [DuckDBTypeId.TIMESTAMP_S]: { kind: 'timestamp' },
  [DuckDBTypeId.TIMESTAMP_MS]: { kind: 'timestamp' },
  [DuckDBTypeId.TIMESTAMP_NS]: { kind: 'timestamp' },
  [DuckDBTypeId.TIMESTAMP_TZ]: { kind: 'timestamp_tz' },
  [DuckDBTypeId.INTERVAL]: { kind: 'interval' },
};

/** Engine type → platform type; nothing DuckDB-specific leaves this function. */
export function toLogicalType(type: DuckDBType): LogicalType {
  switch (type.typeId) {
    case DuckDBTypeId.DECIMAL:
      return { kind: 'decimal', precision: type.width, scale: type.scale };
    case DuckDBTypeId.LIST:
    case DuckDBTypeId.ARRAY:
      return { kind: 'list', element: toLogicalType(type.valueType) };
    case DuckDBTypeId.STRUCT:
      return {
        kind: 'struct',
        fields: type.entryTypes.map((entryType, index) => ({
          name: type.entryNames[index] ?? '',
          type: toLogicalType(entryType),
        })),
      };
    case DuckDBTypeId.MAP:
      return {
        kind: 'map',
        key: toLogicalType(type.keyType),
        value: toLogicalType(type.valueType),
      };
    default:
      return LOGICAL_KINDS_BY_TYPE_ID[type.typeId] ?? { kind: 'other', name: type.toString() };
  }
}

// DuckDB renders "2026-09-23 12:34:56.123456"; out-of-range forms ("infinity", BC years) pass as-is.
const RENDERED_TIMESTAMP = /^(\d{4,}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}(?:\.\d+)?)$/;

/**
 * node-api's JSON converter already keeps 64/128-bit integers and decimals exact as strings
 * (Phase 0, S5). Three types differ from the platform encoding and are converted here — also
 * inside lists, structs and maps, because the JSON converter recurses through this function.
 */
export const platformValueConverter: DuckDBValueConverter<Json> = (value, type, converter) => {
  if (value === null) {
    return null;
  }
  switch (type.typeId) {
    case DuckDBTypeId.TIMESTAMP:
    case DuckDBTypeId.TIMESTAMP_S:
    case DuckDBTypeId.TIMESTAMP_MS:
    case DuckDBTypeId.TIMESTAMP_NS:
      // No zone is attached to a TIMESTAMP, and none is assumed: no `Z`, no offset.
      return String(value).replace(RENDERED_TIMESTAMP, '$1T$2');
    case DuckDBTypeId.TIMESTAMP_TZ:
      return value instanceof DuckDBTimestampTZValue ? formatUtcInstant(value) : String(value);
    case DuckDBTypeId.BLOB:
      return value instanceof DuckDBBlobValue
        ? Buffer.from(value.bytes).toString('base64')
        : String(value);
    default:
      return JsonDuckDBValueConverter(value, type, converter);
  }
};

/** From the stored instant, never from the session time zone the engine would render it in. */
function formatUtcInstant(value: DuckDBTimestampTZValue): string {
  const rendered = new DuckDBTimestampValue(value.micros).toString();
  return RENDERED_TIMESTAMP.test(rendered)
    ? `${rendered.replace(RENDERED_TIMESTAMP, '$1T$2')}Z`
    : rendered;
}

/** Converts what the reader holds; the reader was asked for `maxRows + 1` rows at most. */
export function toQueryResult(reader: DuckDBResultReader, maxRows: number): QueryResult {
  const columns: QueryColumn[] = reader.columnNames().map((name, index) => ({
    name,
    type: toLogicalType(reader.columnType(index)),
  }));
  const rows = reader.convertRows(platformValueConverter) as QueryValue[][];
  const kept = rows.length > maxRows ? rows.slice(0, maxRows) : rows;
  return { columns, rows: kept, rowCount: kept.length, truncated: rows.length > maxRows };
}

/** Positional binding; bigint and decimal arrive as strings and are cast in SQL, losing nothing. */
export function bindParameters(
  prepared: DuckDBPreparedStatement,
  parameters: readonly QueryParameter[],
): void {
  parameters.forEach((value: unknown, index) => {
    const position = index + 1;
    if (value === null) {
      prepared.bindNull(position);
    } else if (typeof value === 'boolean') {
      prepared.bindBoolean(position, value);
    } else if (typeof value === 'string') {
      prepared.bindVarchar(position, value);
    } else if (typeof value === 'number' && Number.isSafeInteger(value)) {
      prepared.bindBigInt(position, BigInt(value));
    } else if (typeof value === 'number') {
      prepared.bindDouble(position, value);
    } else {
      throw new LakehouseError(
        'query_failed',
        `Parameter $${position} is a ${typeof value}; parameters are null, boolean, number or string (bigint and decimal as strings).`,
      );
    }
  });
}
