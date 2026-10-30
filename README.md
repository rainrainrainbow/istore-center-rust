# istore-center-rust

复刻 iStoreOS 软件中心外观的 Rust 版，管理本机 systemd 用户服务。

- **前端**：iStore 风格（蓝 `#007BFF` 主色 / 侧栏灰 / 卡片网格 / 分类 tab / 启停按钮），vanilla JS 无 CDN
- **后端**：`tiny_http` 单二进制，`include_str!` 内嵌前端；`systemctl --user` 操作单元 + 端口探测 + 内存/负载/运行时长
- **构建**：GitHub Actions `cargo-zigbuild` 交叉编译 `aarch64-unknown-linux-musl`（不在本机编译）

## API
- `GET /api/apps` → 应用目录 + 实时状态（`systemctl --user is-active` / 端口探测）
- `POST /api/action` `{unit, action: start|stop|restart}` → 操作 systemd 单元
- `GET /api/system` → 内存/负载/运行时长/架构

## 本机运行
`./istore-center-rust 8086`（默认 8086）
