# 第三方资源说明（重要）

本目录下的 `run.js`、`mtuser-pt-passport-*.tgz`、`package.json`、`config.json`
**不是本项目代码**，来自第三方开源项目 `xiaocan-assistant`（作者未提供 LICENSE）。

- 用途：仅用于本地自用的美团扫码登录与福利社领券；本项目的 Python 侧只调用其 CLI，
  不包含其业务实现。
- 风险：该上游项目**没有 LICENSE 文件**，默认保留所有权利。把本目录随公开仓库/镜像分发，
  属于再分发未授权代码。若要公开发布项目，请先取得作者许可，或删除本目录
  （删除后美团相关接口会返回「运行依赖缺失」，其余功能不受影响）。
- 离线依赖：`mtuser-pt-passport` 不在 npm 公共仓库，只能使用本目录内的 tgz；
  首次运行会由 `server/meituan_runner.py` 解压到 `node_modules` 并建立 `.bin` 软链。
