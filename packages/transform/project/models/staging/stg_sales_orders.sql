MODEL (
  name staging.stg_sales_orders,
  kind VIEW,
  description 'Sales orders from the development dataset, one row per order. Logical only (docs/02 §6.1.1).'
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
FROM lake.fixture.sales_orders
