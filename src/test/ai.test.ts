import test from 'node:test';
import assert from 'node:assert/strict';
import { runAi } from '../ai';

const run = (script: string, limits = {}) => runAi(process.execPath, ['-e', script], process.cwd(), 'context', 'diff', limits);

test('AI CLI consumes stdin and returns stdout', async () => {
    const output = await run("require('fs').writeSync(1, require('fs').readFileSync(0))");
    assert.match(output, /context\n\nSelected diff:\ndiff/);
});
test('AI CLI rejects excessive output and times out hung processes', async () => {
    await assert.rejects(run("require('fs').writeSync(1, 'x'.repeat(4096))", { maxOutputBytes: 1024 }), /output limit/);
    await assert.rejects(run('setInterval(() => {}, 1000)', { timeoutMs: 100 }), /timed out/);
});
test('AI CLI handles missing commands and early stdin closure', async () => {
    await assert.rejects(runAi('aoh-nonexistent-test-command', [], process.cwd(), '', ''), /not found/);
    const result = await runAi(process.execPath, ['-e', "require('fs').writeSync(1, 'done'); process.exit(0)"], process.cwd(), '', 'x'.repeat(1_000_000));
    assert.equal(result, 'done');
});
test('AI CLI substitutes placeholders without stdin', async () => {
    const result = await runAi(process.execPath, ['-e', "require('fs').writeSync(1, process.argv[1])", '{Context}|{Diff}'], process.cwd(), 'ctx', 'patch');
    assert.equal(result, 'ctx|patch');
});

for (const failure of ['timeout', 'output limit'] as const) {
    test(`AI ${failure} terminates wrapper descendants before rejecting`, async t => {
        const { mkdtemp, writeFile, readFile, rm } = await import('node:fs/promises');
        const { tmpdir } = await import('node:os');
        const { join } = await import('node:path');
        const { setTimeout: delay } = await import('node:timers/promises');
        const root = await mkdtemp(join(tmpdir(), 'aoh-ai-tree-'));
        const heartbeat = join(root, 'heartbeat');
        const pidFile = join(root, 'pids');
        const descendant = join(root, 'descendant.cjs');
        const wrapper = join(root, 'wrapper.cjs');
        t.after(async () => {
            // Also clean up when an assertion exposes a regression.
            const pids = await readFile(pidFile, 'utf8').catch(() => '');
            for (const pid of pids.split(',').filter(Boolean).map(Number)) {
                try { process.kill(pid, 'SIGKILL'); } catch {}
            }
            await rm(root, { recursive: true, force: true });
        });
        await writeFile(descendant, `
            const fs = require('fs');
            process.on('SIGTERM', () => {});
            let tick = 0;
            const beat = () => fs.writeFileSync(process.argv[2], String(++tick));
            beat();
            setInterval(beat, 20);
        `);
        await writeFile(wrapper, `
            const fs = require('fs');
            const { spawn } = require('child_process');
            const child = spawn(process.execPath, [process.argv[2], process.argv[3]], { stdio: 'ignore' });
            fs.writeFileSync(process.argv[4], process.pid + ',' + child.pid);
            // Close the wrapper's pipes immediately on TERM while its child ignores TERM.
            process.on('SIGTERM', () => process.exit(0));
            const ready = setInterval(() => {
                if (!fs.existsSync(process.argv[3])) return;
                clearInterval(ready);
                if (process.argv[5] === 'output limit') fs.writeSync(1, 'x'.repeat(4096));
            }, 10);
            setInterval(() => {}, 1000);
        `);
        const operation = runAi(process.execPath, [wrapper, descendant, heartbeat, pidFile, failure],
            root, '', '', { timeoutMs: failure === 'timeout' ? 1_500 : 5_000, maxOutputBytes: 1024 });
        await assert.rejects(operation, failure === 'timeout' ? /timed out/ : /output limit/);
        const lastBeat = await readFile(heartbeat, 'utf8');
        assert.ok(Number(lastBeat) > 0, 'the descendant must actually have started');
        await delay(150);
        assert.equal(await readFile(heartbeat, 'utf8'), lastBeat, 'descendant must stop before runAi rejects');
    });
}
