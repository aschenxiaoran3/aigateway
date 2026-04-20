#!/bin/bash

# AI Gateway 数据库初始化脚本
# 执行时间：2026-04-09

# 数据库配置
DB_HOST="${DB_HOST:-127.0.0.1}"
DB_PORT="${DB_PORT:-3306}"
DB_NAME="${DB_NAME:-ai_gateway}"
DB_USER="${DB_USER:-root}"
DB_PASS="${DB_PASS:-}"

echo "========================================"
echo "🗄️  AI Gateway 数据库初始化"
echo "========================================"
echo ""
echo "数据库信息:"
echo "  Host: $DB_HOST:$DB_PORT"
echo "  Database: $DB_NAME"
echo "  User: $DB_USER"
echo ""

# 执行 SQL 创建表
echo "📋 创建数据库表..."
mysql -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" ${DB_PASS:+-p"$DB_PASS"} "$DB_NAME" < schema.sql

if [ $? -eq 0 ]; then
  echo "✅ 数据库表创建成功！"
  echo ""
  
  # 验证表是否创建成功
  echo "🔍 验证表结构..."
  mysql -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" ${DB_PASS:+-p"$DB_PASS"} "$DB_NAME" -e "SHOW TABLES LIKE 'gateway_%';"
  
  echo ""
  echo "========================================"
  echo "🎉 数据库初始化完成！"
  echo "========================================"
else
  echo "❌ 数据库表创建失败！"
  echo "请检查数据库连接信息是否正确"
  exit 1
fi
