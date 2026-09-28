/** Serialize refreshes and collapse bursts into one pending refresh. */
export class RefreshQueue {
    private pending = false;
    private running?: Promise<void>;
    private stopped = false;

    constructor(private readonly update: () => Promise<void>) {}

    request(): Promise<void> {
        if (this.stopped) return Promise.resolve();
        this.pending = true;
        if (!this.running) {
            this.running = Promise.resolve().then(async () => {
                try {
                    while (this.pending && !this.stopped) {
                        this.pending = false;
                        await this.update();
                    }
                } finally {
                    this.running = undefined;
                }
            });
        }
        return this.running;
    }

    get superseded(): boolean { return this.pending || this.stopped; }

    dispose(): void {
        this.stopped = true;
        this.pending = false;
    }
}
