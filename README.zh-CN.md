<div align="center">

# Skill Switchboard

_一个技能源，连接 Agent，状态清楚。_

[English](./README.md)

</div>

Skill Switchboard 是一款 Obsidian 桌面插件，用于索引 Agent Skills，并检查一个权威源如何连接各个 Agent 目录。

安静的面板和细线与 Desk Lamp、Scriptorium 共享视觉节奏，界面仍跟随 Obsidian 主题；使用本插件不需要安装另外两款产品。设置中提供英文和简体中文。

> [!NOTE]
> 检查只读，修复需要确认。插件不会运行 Agent、harness 命令或工具包。

## 安装

需要 Obsidian 1.7.2 或更新版本，并运行于桌面端。

手动安装：从[发布页面](https://github.com/ouatis/obsidian-skill-switchboard/releases)下载 `main.js`、`manifest.json` 和 `styles.css`，放入 `<vault>/.obsidian/plugins/skill-switchboard/`，再到 **设置 → 第三方插件** 中启用。测试未发布版本，请按下方开发步骤操作。

## 特性

- 从选定的 vault 或桌面目录索引技能，并指定一个权威源。
- 在交互式接线图中查看 `copy`、`symlink` 和 `wrapper` 目标。
- 检查元数据、命令、引用、重复项、路径和 package 资源；不会运行 Agent 或 harness 命令。
- 打开接线台、来源变更后，以及每五分钟自动进行只读检查；也可从命令面板刷新。
- 确认后修复已启用的 wrapper 目标，并复制检查输出用于排查。

## 路径与安全

笔记库内的根目录使用相对路径；外部根目录和目标使用 `~` 路径，便于跨设备复用。也支持单机绝对路径。

来源、目标、启用的 Agent 和 Harness 命令按本机笔记库分别保存到 `~/.skill-switchboard/vaults/<vault-id>/settings.json`。旧接线配置会自动迁移，并保留 `legacy-settings.json` 恢复副本；新设备单独配置接线。技能清单继续共享。0.4.0 以前的版本不会读取这份本机配置。

技能可用 `package_path` 声明配套文件，也可用 `package_id` 引用本机工具包。可选的 schema-v1 `package_manifest` 会列出文件及 SHA-256 哈希；文件缺失、变更或多出时会阻断对应技能。没有清单时，package 资源标为未经验证。每台机器在 `~/.skill-switchboard/packages.json` 中单独映射 package ID 和本地路径；插件不会下载或更新工具包。

插件只检查已配置的根目录和目标。修复前先进行只读检查，列出可处理和受阻的技能供你确认；只写入 vault 以外已启用的 wrapper 目标。资源受阻的技能入口保持原样，独立技能仍可修复，部分完成会明确报告。被替换或移除的文件会备份到 `~/.skill-switchboard/repair-backups/<vault-id>/`，由你决定何时删除；每份备份都带有记录恢复路径的 `backup-index.json`。保存外部 package 路径时，只会更新本机 package registry。

Vault 根目录下的隐藏文件 `.skill-switchboard-status.json` 记录本次安装的版本、构建 ID、技能数量，以及最近的检查和修复输出。文件元数据不含 vault、来源或目标路径，但诊断输出可能包含本机 manifest 或备份路径，分享前请先检查。它不能确认其他设备已同步文件或 Agent 已加载技能。插件不联网，也不收集遥测。

## 命令

- **打开技能接线台**
- **刷新技能索引**
- **复制适配器检查输出**

## 开发

```bash
npm install
npm run dev
npm run build
npm run lint
```

在 `package.json` 中运行 `test:*` 脚本；`test:ui:live` 还需要 Obsidian CLI 和测试库。发布校验需要传入完全匹配的 release tag。CI 使用 Node.js 20、22、24，并在 Linux、macOS 和 Windows 上检查路径行为。要在 Obsidian 中测试，请将 `main.js`、`manifest.json` 和 `styles.css` 复制到上面的插件目录，然后重载应用。

作者：[@ouatis](https://github.com/ouatis)。
