# 库存变动看板

支持本地运行及 GitHub Pages + 腾讯云 SCF 的库存数据看板。登录后可以上传 Excel，并查看统计、趋势、筛选明细和导入记录。保留原有用户、密码校验和管理员权限。

系统只允许存在一个管理员。管理员可以在页面的“用户管理”中新增、启停、删除普通用户以及重置密码；普通用户可以上传和查看库存数据，但不能管理用户。

## 运行

1. 根据 `mysql.example.yaml` 准备 `mysql.yaml`，根据 `auth.example.yaml` 准备 `auth.yaml`。当前目录已有配置时可直接使用。
2. 安装依赖：

   ```powershell
   npm ci
   ```

3. 数据库中尚无管理员时，先创建唯一管理员：

   ```powershell
   npm run auth:create-admin -- "admin" "管理员密码"
   ```

4. 启动：

   ```powershell
   npm start
   ```

5. 浏览器打开 `http://127.0.0.1:3100`。

Pages 登录页公开加载静态资源，所有业务接口都要求登录。登录状态默认保持 12 小时，按原 auth.yaml 或 AUTH_SESSION_HOURS 配置；退出后立即失效。会话保存在 MySQL，Pages 通过签名 Bearer 会话访问 API，支持云函数多实例及禁止第三方 Cookie 的浏览器。

## 用户与密码

用户账号保存在 `dashboard_users` 表中。按照当前项目要求，密码直接以明文保存在数据库的 `password` 字段中，不进行哈希或加密。请只在可信的本机或受控内网环境中使用，并严格限制数据库访问权限。

管理员登录后可在“用户管理”中完成以下操作：

- 新增普通用户
- 启用或停用普通用户
- 重置管理员或普通用户密码
- 删除普通用户

管理员账号不能通过页面删除或停用。数据库表通过唯一约束保证最多只有一个管理员，服务启动时还会校验必须恰好存在一个管理员。

启动时会自动创建：

- `dashboard_users`：登录用户、明文密码、角色和启停状态
- `inventory_import_batches`：Excel 导入批次
- `inventory_updates`：库存变动明细

## Excel 格式

必需列：`SKU编号`、`变动`、`新库存`。

推荐列：`SKU名称`、`账号`、`时间`、`货架位`、`原库存`、`仓库`、`原成本价`、`出入库价`、`现成本价`、`类型`、`单据号`。

系统会根据整行关键内容生成哈希。重复上传相同记录时会跳过，不会重复写入数据库。

## 命令行导入

也可以不打开网页直接导入：

```powershell
npm run import:file -- "库存更新记录.xlsx"
```

## 局域网访问

默认不开放局域网访问。确需在局域网使用时，可以显式设置：

```powershell
$env:HOST = "0.0.0.0"
npm start
```

此时仍应由防火墙、反向代理或可信内网限制访问范围，并使用强密码。

## 在线部署

原始源码保存在 local 分支；test 分支发布静态前端并提供 SCF 运行代码。无需独立管理口令，继续使用 dashboard_users 中的账号；普通用户可以查看和上传，只有管理员可以管理用户。

云函数环境变量使用 MYSQL_CONFIG_YAML（仅含 mysql 字段的 JSON/YAML）、AUTH_SESSION_SECRET（保留原 auth.yaml 的会话密钥）、AUTH_SESSION_HOURS、ALLOWED_ORIGINS 和 NODE_ENV。源码包与前端产物不包含私有配置或凭据。

上传按 1MB 分块，单文件最多 20MB；每个上传会话绑定登录用户，服务端校验 SHA-256 并按文件锁防止并发重复导入。数据库初始化检查已有结构、创建缺失辅助表并记录迁移，不重置已有用户和库存。

```powershell
$env:INVENTORY_API_BASE_URL = 'https://你的函数地址'
npm test
npm run build:pages
```

前端更新推送 test 后由 GitHub Actions 发布；后端修改还需重新部署 SCF。云端使用 Nodejs20.19 HTTP 函数，由 scf_bootstrap 启动并监听 9000 端口。
