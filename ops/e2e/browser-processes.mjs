import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

// Every launched command owns a new POSIX session/process group. Keep the group
// after its leader exits: npm/npx wrappers can leave living descendants behind.
export class BrowserProcesses {
    groups = new Set();
    controller = new AbortController();
    stopped = new Promise((resolve) => {
        this.resolveInterrupted = resolve;
    });

    get interrupted() {
        return this.controller.signal.aborted;
    }
    get signal() {
        return this.controller.signal;
    }
    throwIfInterrupted() {
        if (this.interrupted) throw new Error('Browser fixture interrupted');
    }
    spawn(executable, args, options) {
        this.throwIfInterrupted();
        if (process.platform === 'win32')
            throw new Error(
                'Disposable browser process groups require a POSIX host',
            );
        const child = spawn(executable, args, { ...options, detached: true });
        if (child.pid) this.groups.add(child.pid);
        return child;
    }
    signalGroup(group, signal) {
        try {
            process.kill(-group, signal);
        } catch (error) {
            // macOS can return EPERM while a group member is exiting. This is
            // not proof of exit: liveGroups keeps it owned until ESRCH.
            if (error.code !== 'ESRCH' && error.code !== 'EPERM') throw error;
        }
    }
    liveGroups() {
        return [...this.groups].filter((group) => {
            try {
                process.kill(-group, 0);
                return true;
            } catch (error) {
                if (error.code === 'ESRCH') return false;
                if (error.code === 'EPERM') return true;
                throw error;
            }
        });
    }
    interrupt() {
        if (!this.interrupted) {
            this.controller.abort();
            this.resolveInterrupted();
        }
        for (const group of this.groups) this.signalGroup(group, 'SIGTERM');
    }
    async exit(child) {
        this.throwIfInterrupted();
        return Promise.race([
            new Promise((resolve) => {
                child.once('error', () => resolve(1));
                child.once('exit', (code) => resolve(code ?? 1));
            }),
            this.stopped.then(() => {
                throw new Error('Browser fixture interrupted');
            }),
        ]);
    }
    async stop() {
        for (const group of this.groups) this.signalGroup(group, 'SIGTERM');
        const gracefulDeadline = Date.now() + 2000;
        while (this.liveGroups().length && Date.now() < gracefulDeadline)
            await delay(50);
        for (const group of this.liveGroups())
            this.signalGroup(group, 'SIGKILL');
        const killedDeadline = Date.now() + 2000;
        while (this.liveGroups().length && Date.now() < killedDeadline)
            await delay(50);
        if (this.liveGroups().length)
            throw new Error(
                'Owned browser process groups did not stop; private runtime and lease retained',
            );
    }
}
