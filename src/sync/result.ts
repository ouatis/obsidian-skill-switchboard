export type AdapterCheckStatus = 'passed' | 'failed';

export interface AdapterCheckResult {
	status: AdapterCheckStatus;
	output: string;
	exitCode: number;
}
