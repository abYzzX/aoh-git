import test from 'node:test';
import assert from 'node:assert/strict';
import { RefreshQueue } from '../refreshQueue';

test('refresh bursts run serially, discard superseded state, and converge to latest state', async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => release = resolve);
    let runs = 0;
    let active = 0;
    const published: number[] = [];
    const queue = new RefreshQueue(async () => {
        assert.equal(++active, 1);
        const run = ++runs;
        if (run === 1) await gate;
        if (!queue.superseded) published.push(run);
        active--;
    });
    const first = queue.request();
    await Promise.resolve();
    const requests = Array.from({ length: 20 }, () => queue.request());
    release();
    await Promise.all([first, ...requests]);
    assert.equal(runs, 2);
    assert.deepEqual(published, [2]);
    queue.dispose();
    await queue.request();
    assert.equal(runs, 2);
});

test('a failed refresh does not poison future refreshes', async () => {
    let runs = 0;
    const queue = new RefreshQueue(async () => { if (++runs === 1) throw new Error('failure'); });
    await assert.rejects(queue.request(), /failure/);
    await queue.request();
    assert.equal(runs, 2);
});
