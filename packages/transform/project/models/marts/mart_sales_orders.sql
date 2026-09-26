MODEL (
  name marts.mart_sales_orders,
  kind INCREMENTAL_BY_TIME_RANGE (
    time_column order_date,
    -- Project rule for incremental models on DuckLake (docs/02 §6.1.1): no per-day partitions.
    partition_by_time_column false
  ),
  start '2025-01-01',
  cron '@daily',
  grain order_id,
  description 'Analytical result: one row per sales order. The only model the semantic layer reads.',
  audits (
    not_null(columns := (order_id, order_date, region, amount)),
    unique_values(columns := (order_id)),
    accepted_values(column := region, is_in := ('North', 'South', 'East', 'West', 'Central'))
  )
);

SELECT
  order_id,
  order_date,
  customer_id,
  region,
  product_category,
  quantity,
  unit_price,
  amount
FROM staging.stg_sales_orders
WHERE
  order_date BETWEEN @start_ds AND @end_ds
