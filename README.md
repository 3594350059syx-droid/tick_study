# TickMemory

TickMemory 是一个本地运行的每日学习进度记录工具。它用任务卡片记录每天的学习安排和掌握情况，并支持历史日期浏览、笔记、JSON 导入导出和本地 SQLite 持久化。

## 功能

- 按日期查看和管理学习任务
- 使用四种状态记录掌握程度：未开始、有误但理解、已掌握、完全不会
- 为任务编写 Markdown 风格的学习笔记
- 将当天任务复制到明天
- 导出和导入 JSON 数据
- 浏览器 `localStorage` 与本地 SQLite 数据库双重保存
- 自动保留最近的本地备份

## 环境要求

- Node.js **22.5 或更高版本**
- npm（通常随 Node.js 一起安装）
- Linux/macOS 下使用启动脚本时，建议安装 `curl` 和 `ss`

项目只使用 Node.js 内置模块，不需要安装第三方 npm 依赖。SQLite 使用 Node.js 的内置 `node:sqlite` 模块。

## 快速开始

```bash
git clone <你的 GitHub 仓库地址>
cd tick_memory
npm start
```

启动后打开 <http://127.0.0.1:4173>。

也可以使用脚本：

```bash
./启动TickMemory.sh
```

停止服务：

```bash
./关闭TickMemory.sh
```

如果只想检查语法，可以运行：

```bash
node --check server.js
node --check js/app.js
```

### 自定义端口

默认端口是 `4173`，可以通过环境变量修改：

```bash
PORT=5000 npm start
```

服务默认只监听本机地址 `127.0.0.1`。如需在可信的局域网环境中临时访问，可以显式设置监听地址，但不要在没有认证和 HTTPS 的情况下把它暴露到公网：

```bash
HOST=0.0.0.0 PORT=4173 npm start
```

## 数据文件

| 路径 | 说明 | 是否提交到 Git |
| --- | --- | --- |
| `data/seed.json` | 新安装时使用的示例任务 | 是 |
| `data/tickmemory.db` | 本机 SQLite 数据库，包含实际记录和笔记 | 否 |
| `data/backups/` | 自动生成的本地备份 | 否 |
| `server.log` | 本地运行日志 | 否 |
| `server-err.log` | 本地错误日志 | 否 |

数据库、备份和日志已加入 `.gitignore`，不会通过普通的 `git add .` 上传。请不要手动强制添加这些文件，尤其是包含个人笔记的数据库和备份。

如果需要迁移自己的数据，优先使用页面中的 JSON 导出/导入功能；不要把个人数据库直接提交到公开仓库。

## API

服务端提供以下本地接口：

- `GET /api/health`：健康检查
- `GET /api/state`：读取当前状态
- `PUT /api/state`：保存当前状态

这些接口默认没有用户认证，设计目标是**单用户、本机使用**。不要直接将服务部署到公网。若要多人或远程使用，需要额外增加认证、授权、CSRF 防护、HTTPS 和更严格的输入校验。

## GitHub 上传

在确认 `git status` 中没有个人数据库、备份和日志后，可以执行：

```bash
git add .
git commit -m "chore: prepare project for GitHub"
git branch -M main
git remote add origin https://github.com/<用户名>/<仓库名>.git
git push -u origin main
```

如果远程仓库已经存在，使用 `git remote -v` 检查地址；不要把 GitHub Token 直接写进命令、脚本或源代码。推荐使用 GitHub CLI 登录、SSH key 或系统凭据管理器完成认证。

## 安全说明

- 本项目默认绑定 `127.0.0.1`，不要随意改为公网监听。
- 不要提交 `.env`、数据库、备份、日志、私钥、Token 或密码。
- 如果凭据曾经进入 Git 历史，仅删除当前文件是不够的；需要立即吊销/轮换凭据，并使用 Git 历史清理工具处理历史记录。
- 用户输入的笔记会保存到本地数据库，请根据自己的隐私需求做好备份管理。

## 项目结构

```text
.
├── index.html
├── js/app.js
├── css/
├── data/seed.json
├── server.js
├── 启动TickMemory.sh
├── 关闭TickMemory.sh
├── package.json
└── README.md
```
