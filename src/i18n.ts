export type Language = 'en' | 'zh-CN';

export interface Strings {
	openSwitchboard: string;
	refreshSkillIndex: string;
	skillIndexRefreshed: (count: number) => string;
	viewTitle: string;
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
	repairAllRunning: string;
	repairAllOutput: string;
	repairAllNoDrift: string;
	repairAllPassed: (count: number) => string;
	repairAllFailed: (count: number) => string;
	noRepairTargets: string;
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
	scanInterval: string;
	scanIntervalDescription: string;
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
	viewTitle: 'Skill switchboard',
	refresh: 'Refresh',
	checkAdapters: 'Check adapters',
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
	repairAllRunning: 'Repairing all adapters…',
	repairAllOutput: 'Repair output',
	repairAllNoDrift: 'All enabled adapters are already up to date.',
	repairAllPassed: (count) => `Repair completed for ${count} target${count === 1 ? '' : 's'}; follow-up checks passed.`,
	repairAllFailed: (count) => `Repair finished with ${count} failed target${count === 1 ? '' : 's'}.`,
	noRepairTargets: 'No wrapper targets are configured for repair.',
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
	scanInterval: 'Scan interval (minutes)',
	scanIntervalDescription: 'Used only when automatic scanning is enabled.',
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
	openSwitchboard: '打开技能总控台',
	refreshSkillIndex: '刷新技能索引',
	skillIndexRefreshed: (count) => `技能索引已刷新：${count} 项`,
	viewTitle: '技能总控台',
	refresh: '刷新',
	checkAdapters: '检查适配器',
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
	repairAllRunning: '正在一键修复……',
	repairAllOutput: '修复输出',
	repairAllNoDrift: '所有启用的适配器都已是最新状态。',
	repairAllPassed: (count) => `已修复 ${count} 个目标，复查全部通过。`,
	repairAllFailed: (count) => `修复完成，但仍有 ${count} 个目标失败。`,
	noRepairTargets: '没有配置可修复的 Wrapper 目标。',
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
	scanInterval: '扫描间隔（分钟）',
	scanIntervalDescription: '仅在启用自动扫描时生效。',
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
