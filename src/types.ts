export type RootKind = 'vault' | 'external';

export type SyncMode = 'copy' | 'symlink' | 'wrapper';

export type RuntimeName =
	| 'codex'
	| 'hermes'
	| 'workbuddy'
	| 'opencode'
	| 'antigravity'
	| 'dsh';

export interface SkillRoot {
	id: string;
	label: string;
	path: string;
	kind: RootKind;
	enabled: boolean;
}

export interface RuntimeTarget {
	id: string;
	label: string;
	path: string;
	mode: SyncMode;
	enabled: boolean;
	runtime?: RuntimeName;
}

export interface HarnessDefinition {
	id: string;
	label: string;
	command: string;
	enabled: boolean;
}

export interface IndexedSkill {
	id: string;
	name: string;
	description: string;
	rootLabel: string;
	rootKind: RootKind;
	path: string;
	relativePath: string;
	sha256: string;
	frontmatter: Record<string, string>;
}
