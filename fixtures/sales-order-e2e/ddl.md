# DDL 摘录（E2E）

```sql
CREATE TABLE sales_order (
  `id` BIGINT PRIMARY KEY,
  `order_id` VARCHAR(64) NOT NULL,
  `status` VARCHAR(32) NOT NULL,
  `customer_id` VARCHAR(64),
  `order_qty` DECIMAL(18,2) NOT NULL DEFAULT 0,
  `shipped_qty` DECIMAL(18,2) NOT NULL DEFAULT 0,
  `closed_flag` TINYINT(1) NOT NULL DEFAULT 0
);

CREATE TABLE sales_order_line (
  `id` BIGINT PRIMARY KEY,
  `order_id` VARCHAR(64) NOT NULL,
  `sku` VARCHAR(64) NOT NULL,
  `qty` DECIMAL(18,2) NOT NULL DEFAULT 0,
  `shipped_qty` DECIMAL(18,2) NOT NULL DEFAULT 0
);
```
