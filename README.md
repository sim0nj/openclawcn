OpenClaw 中文站
================

简介
----
- 纯静态站点，包含：首页、安装教程、使用指南、FAQ、论坛页
- 无依赖、易部署，可直接托管在任意静态站服务（Nginx、GitHub Pages、Vercel、OSS/CDN）

目录结构
--------
- index.html               首页
- docs/install.html        安装指南
- docs/usage.html          使用指南
- docs/faq.html            常见问题
- forum/index.html         论坛页（含 Discourse 部署建议）
- assets/styles.css        站点样式

本地预览
--------
在项目根目录启动一个本地静态服务器：

Python:
```bash
python3 -m http.server 8080
```
Node（可选）:
```bash
npx serve .
```
打开浏览器访问 http://localhost:8080/

部署方式
--------
1) GitHub Pages（推荐）
- 将本目录提交到 GitHub 仓库的 main 分支
- 仓库 Settings → Pages → Build and deployment 选择 GitHub Actions
- 工作流已内置于 .github/workflows/pages.yml，推送后自动发布
- 自定义域名：DNS CNAME 指向 <用户名>.github.io 后，在 Pages 中配置并启用 HTTPS

2) Nginx
```nginx
server {
  listen 80;
  server_name openclaw.example.com;
  root /var/www/openclaw-cn-site;
  index index.html;
  location / {
    try_files $uri $uri/ =404;
  }
}
```
- HTTPS：使用 certbot 或接入 Cloudflare。示例：
```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d openclaw.example.com
```

3) Vercel
- 当前仓库已包含 `vercel.json` 与 `/api` 代理函数，可直接部署静态站点
- 在 Vercel 项目中设置两个环境变量：
  - `CHESS_SERVICE_URL`：现有 chess 服务地址，例如 `https://your-chess.example.com/`
  - `GATEWAY_SERVICE_URL`：现有 gateway 服务地址，例如 `https://your-gateway.example.com/`
- Build 命令留空，Root 目录为仓库根目录
- 前端页面继续访问同源 `/api/chess/*` 与 `/api/*`，由 Vercel 代理到你的后端服务
- 注意：房间状态、SSE 与对局循环仍依赖外部后端；不要把 `chess-server/gateway-server` 直接当作 Vercel 无状态函数运行

4) Netlify
- 仅适合纯静态内容；若要保留对战 API，请额外自行配置反向代理或独立后端

5) Docker（便捷上线）
```bash
cd docker
docker build -t openclaw-cn-site ..
docker run -d --name openclaw-cn -p 80:80 openclaw-cn-site
```
或使用 Compose：
```bash
docker compose -f docker/docker-compose.yml up -d --build
```

生产建议
--------
- 将 forum/index.html 中的 `forumLink` 替换为实际论坛域名
- 在导航 GitHub 链接处填入真实仓库地址
- 使用 CDN 缓存静态资源，开启 HTTPS 与 HSTS
- 如需搜索、版本切换或多语言，后续可迁移至 Docusaurus/VitePress 等文档系统

贡献
----
- 内容修改：直接编辑对应 HTML/Markdown
- 风格扩展：修改 assets/styles.css

许可证
------
- 文档内容：CC BY 4.0
- 样式与站点模板：MIT
# openclawcn
