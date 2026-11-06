import type { Module } from '../_server';
import { Config } from '../config';
import { createProvisioner, createProvisioningStore, runProvisioningTick, type ProvisionInput, type ProvisionResult, type ProvisioningStore } from './service';

export function createSiteProvisioningJob(store: ProvisioningStore = createProvisioningStore(), provision: (input: ProvisionInput) => Promise<ProvisionResult> = createProvisioner()): Module {
    return { name: 'Site provisioning recovery', initialize({ fastify, next }) {
        let running = false;
        let stopped = false;
        async function tick() {
            if (running || stopped || !Config.storefrontEnabled) return;
            running = true;
            try { await runProvisioningTick(store, provision, Date.now()); }
            catch { console.error('Site preparation recovery deferred'); }
            finally { running = false; }
        }
        const timer = setInterval(() => { void tick(); }, 5000);
        timer.unref();
        fastify.addHook('onClose', async () => { stopped = true; clearInterval(timer); });
        next();
    } };
}
