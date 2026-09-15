# ERPNext 16 项目核心映射与约束 (PROJECT_MAP.md)

> **⚠️ 核心修改原则与关联仓库声明**
> 本文件记录了本项目的核心 App 标识、GitHub 远程仓库关联、Docker 构建仓库以及 Unraid 运维部署接口。AI 助手与开发人员在执行任何代码修改或部署指令前，必须优先读取并遵守本声明，防止改错目录或项目。

---

## 📌 1. 核心 App 标识与修改对象

- **App 模块标识 (Python & Frappe App Name)**: `ashan_cn_procurement`
- **App 标题 (Title)**: `业务扩展` (ERPNext 16 采购、报销、油卡与受限单据业务扩展)
- **App 核心代码目录**: `ashan_cn_procurement/ashan_cn_procurement`
- **入口 Hooks**: `ashan_cn_procurement/ashan_cn_procurement/hooks.py`
- **Frappe 模块元数据目录**: `ashan_cn_procurement/ashan_cn_procurement/ashan_cn_procurement/`
- **安装包元数据**: `ashan_cn_procurement/pyproject.toml`

---

## 🌐 2. 远程 GitHub 仓库映射

### 业务 App 源码仓库 (App Remote Repository)
- **当前主仓库**: `ashanzzz/erpnext16-ashan`（公开）
- **Git Remote**: `https://github.com/ashanzzz/erpnext16-ashan.git`
- **默认分支**: `main`
- **旧仓库**: `ashanzzz/erpnext-private-customizations`（已归档，只读保留历史，禁止继续推送）
- **当前工作区**: `d:\SynologyDrive团队\antigravity\erpnext16`（即该仓库本地工作区）

### Docker 构建镜像仓库 (Docker Build Remote Repository)
- **仓库名称**: `ashanzzz/docker`
- **构建工作流**: `.github/workflows/erpnext16-single-container-aio.yml`
- **Containerfile 路径**: `erpnext16/single-aio/Containerfile`
- **已产出 GHCR 镜像**: `ghcr.io/ashanzzz/erpnext16:latest`
- **本地修复补丁包**: `ashanzzz-docker-erpnext16-complete-fix/`

---

## 🖥️ 3. Unraid 服务器与 Docker 运维配置

- **Unraid 局域网 IP**: `192.168.8.11`
- **Tailscale 远程访问地址 (异地办公/远程连接自动故障转移)**:
  - **ERPNext16 Web 远程**: `http://100.80.0.4:6888/`
  - **Unraid Web 远程**: `http://100.80.0.4/` (备选端口 `http://100.80.0.4:33/`)
  - **Unraid SSH 远程**: `100.80.0.4:22` (已废弃 `unraid.335356119.xyz`，因其不支持 SSH)
- **Unraid 官方 GraphQL API**: `http://192.168.8.11/graphql` (Tailscale: `http://100.80.0.4/graphql`)
- **Unraid 官方 API Key**: 记录于 `.env` 中的 `UNRAID_OFFICIAL_API_KEY`
- **Unraid 容器名称**:
  - `/erpnext16` (镜像: `ghcr.io/ashanzzz/erpnext16:latest`, 核心部署容器)
  - `/ERPNext` (镜像: `ghcr.io/ashanzzz/erpnext15-aio:latest`, 备用/运行端口 8888)
- **UnraidClaw 网关**: `http://192.168.8.11:9876` (Tailscale: `http://100.80.0.4:9876`)

---

## 📂 4. 本地目录分工与文件结构

```text
d:\SynologyDrive团队\antigravity\erpnext16/
├── ashan_cn_procurement/             # ⭐️ 核心 App 模块源码 (Doctype/Custom/Hooks/Public)
│   ├── pyproject.toml
│   └── ashan_cn_procurement/
│       ├── custom/                   # 字段与单据 Custom 属性（App 级）
│       ├── reimbursement/            # API / 业务服务（App 级）
│       ├── public/                   # 前端 JS/CSS 静态资源与侧边栏
│       ├── hooks.py                  # App 核心钩子文件
│       └── ashan_cn_procurement/     # Frappe 模块（必须保持此层）
│           ├── doctype/              # 自定义 DocType 模块
│           ├── report/               # 标准报表
│           ├── workspace/            # Workspace 布局配置
│           └── workspace_sidebar/    # Workspace Sidebar 配置
│
├── ashanzzz-docker-erpnext16-complete-fix/ # 🐳 给 ashanzzz/docker 仓库准备的 CI/Dockerfile 完整修复包
│   ├── README_FIX.md                 # 包含 Docker 镜像构建失败修复指南
│   ├── apply-to-existing-repo.sh     # 自动应用修复文件到 ashanzzz/docker 的脚本
│   └── erpnext16/                    # 修复后的 Containerfile 与脚本
│
├── docs/                             # 📖 ERPNext 16 AI 开发文档与规范指南
│   └── ai/
│       ├── ASHAN_APP_MODULES_AND_DESIGN_GUIDE.md # ⭐️ 核心模块设计哲学、业务架构与 UI 记忆
│       ├── ERPNext_PROJECT_RULES.md
│       ├── ERPNext16_UI_GUIDE.md
│       ├── ERPNext16_LEARN.md
│       ├── ERPNext16_API_MAP.md
│       └── AI_HANDOVER_LOGIN_AND_GIT_SAFETY.md # 登录路由与公开仓库安全交接，相关任务必须先读
│
├── PROJECT_MAP.md                    # ⭐️ 本规范与映射说明文件
├── AGENTS.md & .agents/              # 🤖 AI 开发指导规则与环境限制
├── .env & .env.example               # 🔑 环境变量配置文件 (含 ERPNext & Unraid API)
└── *.py                              # 🛠️ 自动化初始化、测试与侧边栏配置脚本工具
```
