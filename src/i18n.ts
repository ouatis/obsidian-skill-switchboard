export type Language = 'en' | 'zh-CN';

export interface Strings {
	openSwitchboard: string;
	refreshSkillIndex: string;
	skillIndexRefreshed: (count: number) => string;
	viewTitle: string;
	viewDescription: string;
	skillLibrary: string;
	distributionBoard: string;
	distributionBoardDescription: string;
	distributionShow: string;
	distributionHide: string;
	distributionSource: string;
	distributionSubtitle: (count: number) => string;
	distributionHint: string;
	distributionInspect: string;
	distributionChecked: (passed: number, total: number) => string;
	distributionEmpty: string;
	distributionDisclaimer: string;
	distributionLastCheck: string;
	distributionUnknown: string;
	distributionChecking: string;
	distributionRepairing: string;
	distributionClean: string;
	distributionDrift: string;
	distributionUnavailable: string;
	distributionRepairFailed: string;
	refresh: string;
	checkAdapters: string;
	adapterCheckRunning: string;
	adapterCheckPassed: string;
	adapterCheckFailed: (code: number) => string;
	adapterCheckOutput: string;
	copyOutput: string;
	outputCopied: string;
	copyFailed: string;
	moreLines: (count: number) => string;
	noOutputToCopy: string;
	copyCheckOutput: string;
	repairAllAdapters: string;
	repairAllDescription: string;
	repairConfirmMessage: string;
	confirmRepair: string;
	cancelRepair: string;
	repairAllRunning: string;
	repairAllOutput: string;
	repairAllNoDrift: string;
	repairAllPassed: (count: number) => string;
	repairAllFailed: (count: number) => string;
	noRepairTargets: string;
	checksStale: string;
	checkNotYet: string;
	sourceResourcesBlocked: string;
	resourcesLabel: string;
	resourcesComplete: (packages: number, files: number) => string;
	resourcesWarning: string;
	resourcesFailed: string;
	resourcesNone: string;
	resourceDetails: string;
	resourceIssue: (code: string) => string;
	crossDeviceLabel: string;
	crossDeviceUnverified: string;
	repairSummary: (targets: number, skills: number | null, files: number | null) => string;
	repairChanges: string;
	lastRepairResult: string;
	changeLabel: (kind: string, action: string) => string;
	repairPartial: (files: number | null, failed: number) => string;
	repairBackup: string;
	autoCheck: string;
	autoCheckDescription: string;
	syncSource: string;
	canonicalRoot: string;
	canonicalRootDescription: string;
	chooseSource: string;
	chooseAgent: string;
	syncManifest: string;
	syncManifestDescription: string;
	syncManifestAuto: string;
	externalPackages: string;
	externalPackagesDescription: string;
	externalPackagesEmpty: string;
	externalPackagePath: string;
	externalPackageStorage: string;
	saveLocalPath: string;
	localPathSaved: string;
	localPathSaveFailed: string;
	settings: string;
	settingsNotice: string;
	skills: string;
	roots: string;
	targets: string;
	harnesses: string;
	scanWarnings: string;
	noSkillsTitle: string;
	noSkillsDescription: string;
	readOnlyScan: string;
	noDescription: string;
	technicalDetails: string;
	sourcePath: string;
	searchSkills: string;
	clearSearch: string;
	matchCount: (count: number) => string;
	noSearchResults: string;
	openSource: string;
	pathCopied: string;
	sourceMissing: string;
	jumpToList: string;
	manageInSettings: string;
	sha256: string;
	overview: string;
	overviewDescription: string;
	language: string;
	languageDescription: string;
	english: string;
	chinese: string;
	scanAutomatically: string;
	scanAutomaticallyDescription: string;
	scanDelay: string;
	scanDelayDescription: string;
	skillRoots: string;
	skillRootsDescription: string;
	unnamedRoot: string;
	label: string;
	path: string;
	vaultRelative: string;
	externalDesktopFolder: string;
	enabled: string;
	remove: string;
	addSkillRoot: string;
	newRoot: string;
	runtimeTargets: string;
	runtimeTargetsDescription: string;
	unnamedTarget: string;
	targetPath: string;
	copy: string;
	symlink: string;
	wrapper: string;
	addRuntimeTarget: string;
	newTarget: string;
	harnessesDescription: string;
	unnamedHarness: string;
	commandTemplate: string;
	addHarness: string;
	newHarness: string;
}

const EN: Strings = {
	openSwitchboard: 'Open switchboard',
	refreshSkillIndex: 'Refresh skill index',
	skillIndexRefreshed: (count) => `Skill index refreshed: ${count} skill${count === 1 ? '' : 's'}`,
	viewTitle: 'Skill Switchboard',
	viewDescription: 'One skill source. Connected agents. Clear status.',
	skillLibrary: 'Skill library',
	distributionBoard: 'Agent connections',
	distributionBoardDescription: 'Show a quiet, interactive map of the source and enabled wrapper targets. Status comes from actual checks.',
	distributionShow: 'Show agent connections',
	distributionHide: 'Hide agent connections',
	distributionSource: 'Canonical source',
	distributionSubtitle: (count) => `One source · ${count} target${count === 1 ? '' : 's'}`,
	distributionHint: 'Hover a node or focus an agent in the list. Check adapters to read their state.',
	distributionInspect: 'Hover a node or keyboard-focus an agent in the list.',
	distributionChecked: (passed, total) => `${passed}/${total} checks passed`,
	distributionEmpty: 'Add an enabled wrapper target in settings to connect your agents.',
	distributionDisclaimer: 'File checks only · not proof that an agent has loaded a skill',
	distributionLastCheck: 'Last check',
	distributionUnknown: 'Not checked',
	distributionChecking: 'Checking',
	distributionRepairing: 'Repairing',
	distributionClean: 'Check passed',
	distributionDrift: 'Drift detected',
	distributionUnavailable: 'Cannot check',
	distributionRepairFailed: 'Repair failed',
	refresh: 'Refresh',
	checkAdapters: 'Check skills',
	adapterCheckRunning: 'Checking adapters…',
	adapterCheckPassed: 'Adapter check passed',
	adapterCheckFailed: (code) => `Adapter check failed (exit ${code})`,
	adapterCheckOutput: 'Adapter check output',
	copyOutput: 'Copy output',
	outputCopied: 'Output copied to clipboard',
	copyFailed: 'Copying the output failed',
	moreLines: (count) => `… ${count} more line(s), use copy to get the full output`,
	noOutputToCopy: 'There is no check output to copy yet',
	copyCheckOutput: 'Copy adapter check output',
	repairAllAdapters: 'Repair all',
	repairAllDescription: 'Recheck every enabled wrapper target and repair all drift automatically.',
	repairConfirmMessage: 'This rewrites files outside the vault, in every enabled wrapper target. Overwritten files are backed up first. Continue?',
	confirmRepair: 'Continue repair',
	cancelRepair: 'Cancel',
	repairAllRunning: 'Repairing all adapters…',
	repairAllOutput: 'Repair output',
	repairAllNoDrift: 'All enabled adapters are already up to date.',
	repairAllPassed: (count) => `Repair completed for ${count} target${count === 1 ? '' : 's'}; follow-up checks passed.`,
	repairAllFailed: (count) => `Repair finished with ${count} failed target${count === 1 ? '' : 's'}.`,
	noRepairTargets: 'No wrapper targets are configured for repair.',
	checksStale: 'Source or settings changed. Previous checks are out of date.',
	checkNotYet: 'Not checked yet',
	sourceResourcesBlocked: 'Source resources are incomplete. Restore them before repairing agent entries; adapter repair cannot replace missing toolkit files.',
	resourcesLabel: 'Supporting resources',
	resourcesComplete: (packages, files) => `${packages} package${packages === 1 ? '' : 's'} · ${files} files verified`,
	resourcesWarning: 'Resource verification needs attention',
	resourcesFailed: 'Resources are missing or changed',
	resourcesNone: 'No tool packages declared',
	resourceDetails: 'Resource details',
	resourceIssue: (code) => ({ missing: 'Missing file', changed: 'Content differs from inventory', unexpected: 'File not in inventory', invalid: 'Invalid path or inventory', 'hidden-path': 'Hidden path will not travel through Obsidian Sync', unverified: 'Present, but no file inventory to prove completeness', unconfigured: 'Configure the external package directory on this computer' } as Record<string, string>)[code] ?? code,
	crossDeviceLabel: 'Other devices',
	crossDeviceUnverified: 'Not verified · local checks do not prove download or agent loading',
	repairSummary: (targets, skills, files) => `Repaired ${targets} agent${targets === 1 ? '' : 's'}${skills === null ? '' : ` · ${skills} skill${skills === 1 ? '' : 's'}`}${files === null ? '' : ` · ${files} files written`}; follow-up checks passed.`,
	repairChanges: 'What changed',
	lastRepairResult: 'Last repair',
	changeLabel: (kind, action) => `${({ wrapper: 'Skill entry', metadata: 'Agent metadata', command: 'Command', references: 'Reference resources' } as Record<string, string>)[kind] ?? kind} · ${action === 'created' ? 'created' : 'updated'}`,
	repairPartial: (files, failed) => `${files === null ? 'Changes attempted' : `${files} files written`}; ${failed} target${failed === 1 ? '' : 's'} still need attention.`,
	repairBackup: 'Recovery copy',
	autoCheck: 'Check automatically',
	autoCheckDescription: 'Quiet read-only checks on opening, after source/settings changes, and every five minutes. Repairs still require confirmation.',
	syncSource: 'Distribution source',
	canonicalRoot: 'Canonical source',
	canonicalRootDescription: 'Use this configured root for resource checks and adapter distribution.',
	chooseSource: 'Choose a source',
	chooseAgent: 'Choose an agent',
	syncManifest: 'Adapter manifest',
	syncManifestDescription: 'Vault-relative or explicit desktop path. Leave blank to use skills-manifest.json beside the source directory.',
	syncManifestAuto: 'Automatic sibling manifest',
	externalPackages: 'External tool packages',
	externalPackagesDescription: 'Paths are saved only on this computer, outside the vault. Agents use the same registry. Tool packages are read-only and do not travel through Obsidian Sync.',
	externalPackagesEmpty: 'No skill declares a package_id. Keep skill sources unchanged; declare an external package in its shared card.',
	externalPackagePath: 'Absolute desktop directory or ~/ path. Leave blank and save to remove this computer’s mapping.',
	externalPackageStorage: 'External · this computer only · not included in Obsidian Sync',
	saveLocalPath: 'Save local path',
	localPathSaved: 'Local path saved; readiness will be checked again.',
	localPathSaveFailed: 'Could not save the local path',
	settings: 'Settings',
	settingsNotice: 'Open settings → community plugins → skill switchboard',
	skills: 'Skills',
	roots: 'Roots',
	targets: 'Targets',
	harnesses: 'Harnesses',
	scanWarnings: 'Scan warnings',
	noSkillsTitle: 'No skills indexed yet',
	noSkillsDescription: 'Add a vault-relative or desktop skill root in settings, then refresh. Canonical Markdown cards and SKILL.md adapters are supported.',
	readOnlyScan: 'Read-only scan',
	noDescription: 'No description in frontmatter.',
	technicalDetails: 'Technical details',
	sourcePath: 'Source',
	searchSkills: 'Search skills',
	clearSearch: 'Clear search',
	matchCount: (count) => `${count}`,
	noSearchResults: 'No skill matches this search.',
	openSource: 'Open source',
	pathCopied: 'Path copied to clipboard',
	sourceMissing: 'The source file is no longer in the vault. Refresh the index.',
	jumpToList: 'Go to list',
	manageInSettings: 'Manage in settings',
	sha256: 'SHA-256',
	overview: 'Overview',
	overviewDescription: 'Configure skill roots, runtime targets, and harnesses. The plugin indexes skills, checks every wrapper target, and provides one-click repair.',
	language: 'Language',
	languageDescription: 'Choose the language used by the plugin interface.',
	english: 'English',
	chinese: '简体中文',
	scanAutomatically: 'Scan automatically',
	scanAutomaticallyDescription: 'Refresh the read-only skill index while Obsidian is open.',
	scanDelay: 'Scan delay (milliseconds)',
	scanDelayDescription: 'How long to wait after a file change before rebuilding the index. Higher values absorb bursts of edits.',
	skillRoots: 'Skill roots',
	skillRootsDescription: 'A root may be a vault-relative folder or an external folder. For portable external paths, use ~ for the current user home (for example ~/.codex/skills). Only configured roots are scanned.',
	unnamedRoot: 'Unnamed root',
	label: 'Label',
	path: 'Path',
	vaultRelative: 'Vault-relative',
	externalDesktopFolder: 'External desktop folder',
	enabled: 'Enabled',
	remove: 'Remove',
	addSkillRoot: 'Add skill root',
	newRoot: 'New root',
	runtimeTargets: 'Runtime targets',
	runtimeTargetsDescription: 'Targets describe sync destinations. Use ~ for the current user home (for example ~/.codex/skills) so the vault can move between machines. One-click repair is limited to enabled wrapper targets.',
	unnamedTarget: 'Unnamed target',
	targetPath: 'Target path',
	copy: 'Copy',
	symlink: 'Symlink',
	wrapper: 'Wrapper',
	addRuntimeTarget: 'Add runtime target',
	newTarget: 'New target',
	harnessesDescription: 'Harness commands are stored as configuration only in this MVP. No command is executed yet.',
	unnamedHarness: 'Unnamed harness',
	commandTemplate: 'Command template with {prompt}',
	addHarness: 'Add harness',
	newHarness: 'New harness',
};

const ZH_CN: Strings = {
	openSwitchboard: '打开技能接线台',
	refreshSkillIndex: '刷新技能索引',
	skillIndexRefreshed: (count) => `技能索引已刷新：${count} 项`,
	viewTitle: '技能接线台',
	viewDescription: '统一分发技能，检查各个 Agent 的状态。',
	skillLibrary: '技能库',
	distributionBoard: 'Agent 接线图',
	distributionBoardDescription: '显示权威源与已启用 Wrapper 目标的交互总览，状态来自实际检查。',
	distributionShow: '显示接线图',
	distributionHide: '隐藏接线图',
	distributionSource: '权威源',
	distributionSubtitle: (count) => `一份权威源 · ${count} 个目标`,
	distributionHint: '悬停节点或聚焦列表中的 Agent；点击“检查适配器”读取状态。',
	distributionInspect: '悬停节点或键盘聚焦列表中的 Agent，可查看详情。',
	distributionChecked: (passed, total) => `${passed}/${total} 检查通过`,
	distributionEmpty: '请在设置中添加已启用的 Wrapper 目标，接入你的 Agent。',
	distributionDisclaimer: '仅检查文件 · 不代表 Agent 已实际加载技能',
	distributionLastCheck: '上次检查',
	distributionUnknown: '未检查',
	distributionChecking: '检查中',
	distributionRepairing: '修复中',
	distributionClean: '检查通过',
	distributionDrift: '存在漂移',
	distributionUnavailable: '无法检查',
	distributionRepairFailed: '修复失败',
	refresh: '刷新',
	checkAdapters: '检查技能',
	adapterCheckRunning: '正在检查适配器……',
	adapterCheckPassed: '适配器检查通过',
	adapterCheckFailed: (code) => `适配器检查失败（退出码 ${code}）`,
	adapterCheckOutput: '适配器检查输出',
	copyOutput: '复制输出',
	outputCopied: '输出已复制到剪贴板',
	copyFailed: '复制输出失败',
	moreLines: (count) => `… 另有 ${count} 行，用「复制输出」查看完整内容`,
	noOutputToCopy: '还没有可复制的检查输出',
	copyCheckOutput: '复制适配器检查输出',
	repairAllAdapters: '一键修复',
	repairAllDescription: '复查所有启用的 Wrapper 目标，并自动修复全部漂移。',
	repairConfirmMessage: '这会重写库外每个已启用 Wrapper 目标中的文件。将被覆盖的文件会先备份。是否继续？',
	confirmRepair: '继续修复',
	cancelRepair: '取消',
	repairAllRunning: '正在一键修复……',
	repairAllOutput: '修复输出',
	repairAllNoDrift: '所有启用的适配器都已是最新状态。',
	repairAllPassed: (count) => `已修复 ${count} 个目标，复查全部通过。`,
	repairAllFailed: (count) => `修复完成，但仍有 ${count} 个目标失败。`,
	noRepairTargets: '没有配置可修复的 Wrapper 目标。',
	checksStale: '来源或设置已变化，旧检查结果已失效。',
	checkNotYet: '尚未检查',
	sourceResourcesBlocked: '配套资源不完整，请先恢复资源。修复 Agent 入口不能补回丢失的工具包文件。',
	resourcesLabel: '配套资源',
	resourcesComplete: (packages, files) => `${packages} 个工具包 · ${files} 个文件校验一致`,
	resourcesWarning: '资源校验有待确认',
	resourcesFailed: '资源缺失或内容已变化',
	resourcesNone: '未声明配套工具包',
	resourceDetails: '资源检查明细',
	resourceIssue: (code) => ({ missing: '文件缺失', changed: '内容与清单不一致', unexpected: '清单之外的文件', invalid: '路径或清单无效', 'hidden-path': '隐藏路径不参与 Obsidian Sync', unverified: '资源存在，但尚无清单证明完整性', unconfigured: '请在这台电脑配置外部工具包目录' } as Record<string, string>)[code] ?? code,
	crossDeviceLabel: '其他设备',
	crossDeviceUnverified: '尚未核验 · 本地检查不代表已下载或 Agent 已加载',
	repairSummary: (targets, skills, files) => `已修复 ${targets} 个 Agent${skills === null ? '' : ` 的 ${skills} 项技能`}${files === null ? '' : `，写入 ${files} 个文件`}，复查通过。`,
	repairChanges: '具体改动',
	lastRepairResult: '上次修复',
	changeLabel: (kind, action) => `${({ wrapper: '技能入口', metadata: 'Agent 元数据', command: '命令', references: '参考资源' } as Record<string, string>)[kind] ?? kind} · ${action === 'created' ? '已创建' : '已更新'}`,
	repairPartial: (files, failed) => `${files === null ? '已尝试修复' : `已写入 ${files} 个文件`}，仍有 ${failed} 个目标需要处理。`,
	repairBackup: '恢复副本',
	autoCheck: '自动检查',
	autoCheckDescription: '打开接线台、来源或设置变化后，以及每五分钟静默进行只读检查。写入仍需确认。',
	syncSource: '分发来源',
	canonicalRoot: '唯一来源',
	canonicalRootDescription: '从已配置的来源中选择用于资源检查和 Agent 分发的目录。',
	chooseSource: '选择来源',
	chooseAgent: '选择 Agent',
	syncManifest: '适配器清单',
	syncManifestDescription: 'Vault 内相对路径或明确的外部路径。留空时使用来源目录旁的 skills-manifest.json。',
	syncManifestAuto: '自动使用相邻清单',
	externalPackages: '外部工具包',
	externalPackagesDescription: '路径仅保存在本机库外，Agent 共用同一登记文件。工具包只读，不随 Obsidian Sync 同步；无需更改技能来源。',
	externalPackagesEmpty: '尚无技能声明 package_id。外部工具包由共享入口声明，不作为新的技能来源。',
	externalPackagePath: '填写库外绝对目录或 ~/ 路径。留空并保存可移除本机登记。',
	externalPackageStorage: '本机库外 · 不参与 Obsidian Sync',
	saveLocalPath: '保存本机路径',
	localPathSaved: '本机路径已保存，将重新检查。',
	localPathSaveFailed: '本机路径保存失败',
	settings: '设置',
	settingsNotice: '请打开“设置 → 第三方插件 → Skill Switchboard”',
	skills: '技能',
	roots: '来源目录',
	targets: '运行时目标',
	harnesses: 'Harness',
	scanWarnings: '扫描警告',
	noSkillsTitle: '还没有索引到技能',
	noSkillsDescription: '请在设置中添加 vault 内相对目录或桌面目录，然后刷新。插件支持 canonical Markdown 卡片和 SKILL.md 适配器。',
	readOnlyScan: '只读扫描',
	noDescription: 'frontmatter 中没有描述。',
	technicalDetails: '技术信息',
	sourcePath: '来源',
	searchSkills: '搜索技能',
	clearSearch: '清除搜索',
	matchCount: (count) => `${count} 条`,
	noSearchResults: '没有匹配的结果。',
	openSource: '打开源文件',
	pathCopied: '路径已复制到剪贴板',
	sourceMissing: '源文件已不在库中，请刷新索引。',
	jumpToList: '跳到列表',
	manageInSettings: '去设置中管理',
	sha256: 'SHA-256',
	overview: '概览',
	overviewDescription: '配置技能来源目录、运行时目标和 Harness。插件会建立索引、检查所有 Wrapper 目标，并提供一键修复。',
	language: '界面语言',
	languageDescription: '选择插件界面使用的语言。',
	english: 'English',
	chinese: '简体中文',
	scanAutomatically: '自动扫描',
	scanAutomaticallyDescription: 'Obsidian 打开时刷新只读技能索引。',
	scanDelay: '扫描延迟（毫秒）',
	scanDelayDescription: '文件变动后等待多久再重建索引。调大可吸收连续编辑。',
	skillRoots: '技能来源目录',
	skillRootsDescription: '来源可以是 vault 内相对目录，也可以是外部目录。为便于跨机器使用，外部路径请用 ~ 表示当前用户主目录，例如 ~/.codex/skills。插件只扫描已配置的来源。',
	unnamedRoot: '未命名来源',
	label: '名称',
	path: '路径',
	vaultRelative: 'Vault 内相对路径',
	externalDesktopFolder: '桌面外部目录',
	enabled: '启用',
	remove: '移除',
	addSkillRoot: '添加技能来源',
	newRoot: '新来源',
	runtimeTargets: '运行时目标',
	runtimeTargetsDescription: '目标用于描述同步目的地。为便于跨机器使用，请用 ~ 表示当前用户主目录，例如 ~/.codex/skills。一键修复仅限启用的 Wrapper 目标。',
	unnamedTarget: '未命名目标',
	targetPath: '目标路径',
	copy: '复制',
	symlink: '符号链接',
	wrapper: 'Wrapper',
	addRuntimeTarget: '添加运行时目标',
	newTarget: '新目标',
	harnessesDescription: 'Harness 命令当前只作为配置保存，插件还不会执行命令。',
	unnamedHarness: '未命名 Harness',
	commandTemplate: '包含 {prompt} 的命令模板',
	addHarness: '添加 Harness',
	newHarness: '新 Harness',
};

export function getStrings(language: Language): Strings {
	return language === 'zh-CN' ? ZH_CN : EN;
}
