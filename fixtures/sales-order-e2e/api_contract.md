# 销售订单接口契约（E2E）

POST /api/v1/sales-orders
POST /api/v1/sales-orders/{order_id}/submit
POST /api/v1/sales-orders/{order_id}/approve
POST /api/v1/sales-orders/{order_id}/reject
POST /api/v1/sales-orders/{order_id}/cancel
POST /api/v1/sales-orders/{order_id}/confirm

请求 JSON:
```json
{
  "customer_id": "C001",
  "order_qty": 10,
  "lines": [{ "sku": "SKU1", "qty": 10 }]
}
```

响应 JSON:
```json
{
  "order_id": "SO-001",
  "status": "draft",
  "shipped_qty": 0,
  "closed_flag": false
}
```
