# 项目文件整理说明

本文档说明项目的文件整理情况。

## 整理日期
2026-03-15

## 整理内容

### 1. 创建新目录
- **scripts/** - 管理脚本目录
- **doc/** - 文档目录

### 2. 移动的文件

#### 脚本文件（5个）→ scripts/
- check-logs.bat
- clean-reset.bat
- fix-network-stack.bat
- manage-processes.ps1
- restart-services.ps1

#### 文档文件（3个）→ doc/
- DEVELOP.md
- TROUBLESHOOTING.md
- QUICKSTART.md

### 3. 新增文件
- **scripts/README.md** - 脚本使用说明
- **doc/README.md** - 文档索引说明

### 4. 更新文件
- **README.md** - 更新目录结构，添加文档链接

## 最终目录结构

```
ai-agent-remote/
├── client/              # 客户端（桌面端）
├── server/              # 服务端（Web Server）
├── utils/               # 工具模块
├── scripts/             # 管理脚本（新增）
├── doc/                # 文档目录（新增）
├── deploy/              # 部署脚本
├── config.json          # 主配置文件
├── README.md            # 项目说明（已更新）
└── ...                 # 其他配置文件
```

## 清理的文件

在本次整理之前，已清理了所有与 Tailscale 和 Headscale 相关的文件，包括：
- Tailscale 相关脚本（4个）
- Tailscale 相关文档（3个）
- P2P 网络相关文档（2个）
- 其他无用文件

## 使用指南

### 查看文档
所有文档都在 `doc/` 目录中：
- 开发文档：[doc/DEVELOP.md](doc/DEVELOP.md)
- 快速开始：[doc/QUICKSTART.md](doc/QUICKSTART.md)
- 故障排查：[doc/TROUBLESHOOTING.md](doc/TROUBLESHOOTING.md)

### 使用脚本
所有管理脚本都在 `scripts/` 目录中：
- 进程管理：`.\scripts\manage-processes.ps1`
- 查看日志：`.\scripts\check-logs.bat`
- 网络修复：`.\scripts\fix-network-stack.bat`

详细说明请参考 [scripts/README.md](scripts/README.md)。

## 优势

1. **结构清晰**：脚本和文档分类存放，易于查找
2. **便于维护**：相关文件集中管理
3. **减少混乱**：根目录只保留核心文件
4. **文档完善**：每个目录都有 README 说明

## 注意事项

- 所有脚本路径已更新到新位置
- README.md 中的文档链接已更新
- 如有外部引用，需要更新路径
