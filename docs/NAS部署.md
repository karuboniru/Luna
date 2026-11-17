# Linux / NAS 网页版部署

适用于新建媒体库、单实例、可信用户。数据库放在 NAS 本机存储卷；一个 `/data` 只交给一个容器使用。网页没有内置认证，远程访问须由 NAS 反向代理提供 HTTPS 和身份验证。此流程不迁移 Windows 媒体库数据。

## 使用 Compose

需要 Docker Engine 与 Compose v2，处理器为 `linux/amd64` 或 `linux/arm64`。镜像地址为 `ghcr.io/karuboniru/luna`，首次发布已验证可匿名访问，无需 GitHub 登录。发布状态以 [Actions 运行结果](https://github.com/karuboniru/Luna/actions/workflows/nas-container.yml) 和实际拉取结果为准。

将仓库的 `compose.yaml` 放到部署目录，例如 `/srv/luna`，准备持久目录并配置权限：

```sh
cd /srv/luna
mkdir -p luna-data luna-cache
# 使用实际 NAS 用户的 UID/GID；以下以 1000:1000 为例。
sudo chown 1000:1000 luna-data luna-cache
```

在相同目录建立 `.env`，将媒体目录换成已有的 NAS 绝对路径：

```dotenv
LUNA_UID=1000
LUNA_GID=1000
LUNA_MEDIA_DIR=/volume1/media
LUNA_DATA_DIR=./luna-data
LUNA_CACHE_DIR=./luna-cache
LUNA_IMAGE_TAG=latest
BASE_PATH=
```

```sh
docker compose config
docker compose pull
docker compose up -d --no-build
docker compose ps
docker compose logs --tail=100 luna
```

Compose 默认只发布 `127.0.0.1:8787`，适合宿主机反向代理。若代理也是容器，应将两者接入共同网络，代理使用 `http://luna:8787`。需要直接从可信局域网连接时，可在 `.env` 设置 `LUNA_BIND_IP=0.0.0.0`，并限制防火墙访问来源。

启动后在网页添加媒体库，输入容器内的 `/media` 或 `/media/music`，也可使用网页的服务器目录浏览。此处路径指 NAS 容器中的目录。浏览器电脑上的 `D:\Music` 或本地文件夹无法作为扫描根目录。

## 目录和权限

| 容器路径 | 用途 | 默认权限 |
| --- | --- | --- |
| `/data` | SQLite 数据库、配置、封面、写回撤销记录等持久数据 | 读写 |
| `/cache` | ZIP 音轨展开和播放缓存，可重新生成 | 读写 |
| `/media` | 宿主机已有的音乐、音声及 ZIP | 只读 |

镜像默认以 `node` 用户（UID/GID 为 `1000:1000`）运行；Compose 的 `user` 使用 `LUNA_UID`、`LUNA_GID`。这是直接切换进程用户，并不会自动修复宿主机目录权限。所选用户必须能读 `/media`，能遍历所有父目录，并能写入 `/data`、`/cache`。NAS 的 ACL 也需要授予相应权限。Compose 要求绑定源目录已存在，避免路径写错后自动创建空目录。

媒体只读时仍可扫描、播放、收藏及编辑数据库内的标签。若要将音频元数据写回媒体文件，先备份媒体，再将 `compose.yaml` 中 `/media` 挂载项的 `read_only: true` 改成 `read_only: false`，同时为对应 UID/GID 授予宿主机媒体的写权限，然后执行：

```sh
docker compose up -d --force-recreate --no-build
```

## 环境变量

| 变量 | 镜像默认值 | 说明 |
| --- | --- | --- |
| `HOST` | `0.0.0.0` | 容器监听地址 |
| `PORT` | `8787` | 容器监听端口；Compose 固定该值 |
| `LAM_DATA_DIR` | `/data` | 数据目录 |
| `LAM_CACHE_DIR` | `/cache` | 新配置的 ZIP 缓存默认目录；已保存的网页设置优先 |
| `LAM_MEDIA_DIR` | `/media` | 网页目录浏览的默认起点 |
| `BASE_PATH` | 空 | 外部 URL 前缀，例如 `/luna` |
| `LUNA_DLSITE_INDEX` | 未设置 | 可选外部 DLsite SQLite 索引文件路径 |

`.env` 中的 `LUNA_DATA_DIR`、`LUNA_CACHE_DIR`、`LUNA_MEDIA_DIR` 是 Compose 宿主机挂载源，与容器内的 `LAM_*` 路径不同。`LUNA_PORT` 只修改宿主机发布端口。修改 `.env` 后应运行 `docker compose up -d --no-build`，单独重启容器不会更新环境变量。

镜像只包含 Node.js、应用代码和生产依赖，不包含 Electron、个人数据或外部 DLsite 索引。缺少索引不影响建立本地媒体库。若已有合法取得的索引，可将索引目录额外只读挂载到 `/indexes`，并设置 `LUNA_DLSITE_INDEX=/indexes/dlsite.sqlite`（替换为实际文件名）。不要将索引放进构建上下文或镜像。

## Nginx 根路径反向代理

保持 `BASE_PATH` 为空。在已经配置 HTTPS 的站点 `server` 块中添加以下内容，并预先建立 Basic Auth 密码文件；也可替换成 NAS 已有的统一认证：

```nginx
location / {
    auth_basic "Luna";
    auth_basic_user_file /etc/nginx/luna.htpasswd;

    proxy_pass http://127.0.0.1:8787;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_buffering off;
    proxy_read_timeout 300s;
    client_max_body_size 20m;
}
```

访问 `https://你的域名/`。Nginx 默认转发 `Range` 请求头，保留该行为以支持拖动音频播放。不要在媒体响应上启用会改变内容长度的代理改写。

## Nginx 子路径反向代理

在 `.env` 设置 `BASE_PATH=/luna` 并重新创建容器。站点对应配置：

```nginx
location = /luna {
    return 308 /luna/;
}

location /luna/ {
    auth_basic "Luna";
    auth_basic_user_file /etc/nginx/luna.htpasswd;

    # 此处 upstream 后不能追加 /；传给应用的 URI 要保留 /luna/。
    proxy_pass http://127.0.0.1:8787;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_buffering off;
    proxy_read_timeout 300s;
    client_max_body_size 20m;
}
```

访问 `https://你的域名/luna/`。反向代理必须保留前缀，应用会在 `/luna` 下挂载网页、API、封面、播放和下载。不要配置去除 `/luna` 的 rewrite，也不要另外添加 `X-Forwarded-Prefix`。健康检查会自动请求容器内的 `/luna/api/health`。

## 升级和备份

```sh
docker compose pull
docker compose up -d --no-build
docker compose ps
```

升级不删除绑定的数据目录。备份时先 `docker compose stop luna`，完整备份 `luna-data` 后再 `docker compose start luna`，避免只复制 SQLite 主文件而遗漏 WAL。`luna-cache` 可以重建。媒体的独立备份仍由 NAS 管理。回退镜像前也要保留与旧版本兼容的数据备份。

## 从源码构建和发布

本地从本仓库构建（不要求安装 Electron）：

```sh
docker build -t luna:nas-local .
# 或在已配置上述 .env 的仓库中：
docker compose build
docker compose up -d --pull never
```

Dockerfile 使用 Node 24 Debian slim，通过固定版本 pnpm 和 `--frozen-lockfile` 安装生产依赖；安装源显式使用 `registry.npmjs.org`，不读取桌面版 Electron 镜像配置。`.dockerignore` 使用允许列表，只发送运行源码、依赖清单和健康检查脚本。

[NAS container 工作流](../.github/workflows/nas-container.yml) 先执行 `npm run test:nas`，构建本地 amd64 镜像并验证根路径和 `/luna` 的容器启动，再构建并向 GHCR 推送 `linux/amd64`、`linux/arm64` 多架构镜像。Actions 使用官方仓库的完整提交 SHA 固定版本；工作流默认只有读权限，发布任务单独授予 `packages: write`。

- 推送 `main`：发布 `latest` 和 `sha-完整提交号`。
- 推送 `nas-v1.0.0` 等 NAS 版本标签：发布同名镜像标签及 SHA 标签。支持 `nas-v1.0.0-rc.1`；版本发布不覆盖 `latest`。
- 手动运行：发布所选分支/标签的 SHA 标签；仅选择 `main` 时更新 `latest`。
- Pull request：执行测试和本地镜像启动验证，不推送镜像。

NAS 使用独立的 `nas-v*` 标签，以免继承的 Windows `v*` 标签误发布为 NAS 版本。部署固定版本时，例如设置 `LUNA_IMAGE_TAG=nas-v1.0.0`；该示例表示标签格式，不代表此版本已经发布。维护者可在 fork 的 Actions 页面启用工作流后，查看测试、构建和推送的真实结果。
