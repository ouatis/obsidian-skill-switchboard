/** An asynchronous result is valid only for the source/configuration revision it checked. */
export class CheckFreshness {
	private revision = 0;
	private checkedRevision = -1;
	get stale(): boolean { return this.checkedRevision !== this.revision; }
	invalidate(): void { this.revision++; }
	capture(): number { return this.revision; }
	isCurrent(revision: number): boolean { return revision === this.revision; }
	accept(revision: number): boolean {
		if (!this.isCurrent(revision)) return false;
		this.checkedRevision = revision;
		return true;
	}
}
