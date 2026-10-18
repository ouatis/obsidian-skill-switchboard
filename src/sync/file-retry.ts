import { setTimeout as delay } from 'node:timers/promises';

/** Retry only transient filesystem refusal, never validation failures or stale consent. */
export async function retryFileOperation<T>(operation: () => Promise<T>, current: () => boolean = () => true,
	wait: (ms: number) => Promise<void> = (ms) => delay(ms)): Promise<T> {
	for (let attempt = 0; ; attempt++) {
		if (!current()) throw new Error('Repair was cancelled before filesystem replacement.');
		try { return await operation(); }
		catch (error) {
			const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
			if (attempt >= 2 || !['EBUSY', 'EPERM', 'EACCES'].includes(String(code))) throw error;
			await wait(attempt === 0 ? 150 : 450);
		}
	}
}
