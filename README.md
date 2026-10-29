# 库存变动看板

本地运行的库存数据看板。可以上传 Excel，把库存变动明细写入 MySQL，并在浏览器中查看统计、趋势、筛选明细和导入记录。应用不包含账号密码模块，默认只监听本机地址 `127.0.0.1`。

## 运行

1. 根据 `mysql.example.yaml` 准备 `mysql.yaml`。当前目录已有配置时可直接使用。
2. 安装依赖：

   ```powershell
   pnpm install
   ```

3. 启动：

   ```powershell
   pnpm start
   ```

4. 浏览器打开 `http://127.0.0.1:3100`。

启动时会自动创建：

- `inventory_import_batches`：Excel 导入批次
- `inventory_updates`：库存变动明细

## Excel 格式

必需列：`SKU编号`、`变动`、`新库存`。

推荐列：`SKU名称`、`账号`、`时间`、`货架位`、`原库存`、`仓库`、`原成本价`、`出入库价`、`现成本价`、`类型`、`单据号`。

系统会根据整行关键内容生成哈希。重复上传相同记录时会跳过，不会重复写入数据库。

## 命令行导入

也可以不打开网页直接导入：

```powershell
pnpm run import:file -- "C:\Users\ASUSA\Downloads\库存更新记录_2026-10-29.xlsx"
```

## 局域网访问

默认不开放局域网访问，因为应用没有登录验证。确需在局域网使用时，可以显式设置：

```powershell
$env:HOST = "0.0.0.0"
pnpm start
```

此时应由防火墙、反向代理或可信内网限制访问范围。
