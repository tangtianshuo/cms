import type { ChecklistStep } from '@bcms/selfhosted-backend/presets/checklist';
import type { ImportPlan } from '@bcms/selfhosted-backend/presets/import';
import type { SiteInstallation } from '@bcms/selfhosted-backend/presets/site-model';
import type { Sdk } from '../../sdk/main';

export const onboardingSteps = [
    'template',
    'identity',
    'content',
    'preview',
    'publish',
] as const;
export type OnboardingStep = (typeof onboardingSteps)[number];
export interface OnboardingTemplate {
    id: string;
    version: string;
    name: string;
    description: string;
    heroImage: string;
    sourceCommit?: string;
    manifestChecksum?: string;
    theme: {
        background: string;
        foreground: string;
        accent: string;
        muted: string;
        font: string;
    };
}
export interface SiteOnboardingState {
    step: OnboardingStep;
    presetId: string;
    presetVersion: string;
    sourceCommit: string;
    manifestChecksum: string;
    siteName: string;
    includeDemo: boolean;
    importRequested: boolean;
    creation?: { name: string; baselineIds: string[]; siteId?: string };
}
interface Scope {
    userId: string;
    workspaceId: string;
    siteId?: string;
    admin: boolean;
}
interface Dependencies {
    sdk: Pick<Sdk, 'send' | 'selectContext'>;
    storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
    scope: Scope;
    now?: () => number;
    onChange?: () => void;
}
export function onboardingStorageKey(
    scope: Pick<Scope, 'userId' | 'workspaceId' | 'siteId'>,
) {
    return `cms-site-setup-v1:${JSON.stringify([
        scope.userId,
        scope.workspaceId,
        scope.siteId || '',
    ])}`;
}
function initialState(): SiteOnboardingState {
    return {
        step: 'template',
        presetId: '',
        presetVersion: '',
        sourceCommit: '',
        manifestChecksum: '',
        siteName: '',
        includeDemo: false,
        importRequested: false,
    };
}

/** All mutations are explicit. Reading an installed site never imports or adopts it. */
const creationLocks = new Map<string, Promise<unknown>>();
export function createSiteOnboarding(deps: Dependencies) {
    const key = onboardingStorageKey(deps.scope);
    const selector = {
        workspaceId: deps.scope.workspaceId,
        ...(deps.scope.siteId ? { siteId: deps.scope.siteId } : {}),
    };
    let refreshing: Promise<void> | undefined;
    let storageUnreadable = false;
    let currentChoice: OnboardingTemplate | undefined;
    const controller = {
        state: initialState(),
        site: null as SiteInstallation | null,
        catalog: [] as OnboardingTemplate[],
        plan: null as ImportPlan | null,
        checklist: [] as ChecklistStep[],
        busy: false,
        registryUnavailable: false,
        storageError: false,
        creationUncertain: false,
        creationCandidates: [] as SiteInstallation[],
        get selected() {
            return currentChoice;
        },
        get optionsLocked() {
            return (
                !!controller.state.creation ||
                controller.state.importRequested ||
                (!!controller.site && controller.site.status !== 'empty')
            );
        },
        get importing() {
            return (
                controller.site?.status === 'importing' ||
                (controller.state.importRequested &&
                    controller.site?.status === 'empty')
            );
        },
        get canRetryPendingImport() {
            return (
                controller.state.importRequested &&
                controller.site?.status === 'empty'
            );
        },
        get canResume() {
            const site = controller.site;
            return (
                !!site &&
                (site.status === 'failed' ||
                    (site.status === 'importing' &&
                        (deps.now?.() ?? Date.now()) - site.updatedAt >=
                            120000))
            );
        },
        update(
            values: Partial<
                Pick<SiteOnboardingState, 'siteName' | 'includeDemo'>
            >,
        ) {
            if (controller.optionsLocked) return;
            Object.assign(controller.state, values);
            save();
            changed();
        },
        chooseTemplate(item: OnboardingTemplate) {
            if (controller.optionsLocked) return;
            currentChoice = item;
            Object.assign(controller.state, {
                presetId: item.id,
                presetVersion: item.version,
                sourceCommit: item.sourceCommit || '',
                manifestChecksum: item.manifestChecksum || '',
            });
            controller.plan = null;
            save();
            changed();
        },
        async load() {
            try {
                controller.state = readState(key) || initialState();
            } catch {
                controller.storageError = true;
                storageUnreadable = true;
            }
            if (!deps.scope.admin) {
                changed();
                return;
            }
            const result = await deps.sdk.send<{
                items: OnboardingTemplate[];
                registryError?: string;
            }>({
                url: '/api/v4/presets/catalog',
                method: 'GET',
                selectorOverride: selector,
            });
            controller.catalog = result.items;
            controller.registryUnavailable = !!result.registryError;
            currentChoice = controller.catalog.find(
                (item) =>
                    item.id === controller.state.presetId &&
                    item.version === controller.state.presetVersion &&
                    (item.sourceCommit || '') ===
                        controller.state.sourceCommit &&
                    (item.manifestChecksum || '') ===
                        controller.state.manifestChecksum,
            );
            await controller.refresh();
            if (
                deps.scope.siteId &&
                controller.state.presetId &&
                controller.site?.status === 'empty'
            )
                await controller.loadPlan();
            changed();
        },
        async refresh() {
            if (!deps.scope.admin || !deps.scope.siteId) return;
            if (refreshing) return refreshing;
            refreshing = (async () => {
                const result = await deps.sdk.send<{
                    site: SiteInstallation | null;
                    checklist: ChecklistStep[];
                }>({
                    url: '/api/v4/presets/site',
                    method: 'GET',
                    selectorOverride: selector,
                });
                if (result.site && result.site._id !== deps.scope.siteId)
                    throw new Error('网站选择已变更，请重新选择网站。');
                controller.site = result.site;
                controller.checklist = result.checklist;
                const site = result.site;
                if (site && site.status !== 'empty') {
                    let record: {
                        sourceCommit?: string;
                        manifestChecksum?: string;
                    } = {};
                    try {
                        record = JSON.parse(
                            site.publishedTemplateRecord || '{}',
                        );
                    } catch {
                        /* Invalid installed records are reported by the existing release checks. */
                    }
                    Object.assign(controller.state, {
                        presetId: site.presetId,
                        presetVersion: site.presetVersion,
                        sourceCommit: record.sourceCommit || '',
                        manifestChecksum: record.manifestChecksum || '',
                        siteName: site.name,
                        includeDemo: site.includeDemo,
                        importRequested: site.status !== 'ready',
                    });
                    currentChoice = controller.catalog.find(
                        (item) =>
                            item.id === site.presetId &&
                            item.version === site.presetVersion &&
                            (item.sourceCommit || '') ===
                                (record.sourceCommit || ''),
                    );
                    if (
                        site.status !== 'ready' ||
                        ['template', 'identity'].includes(controller.state.step)
                    )
                        controller.state.step = 'content';
                    save();
                    if (site.status === 'ready') {
                        try {
                            const pendingKey = onboardingStorageKey({
                                ...deps.scope,
                                siteId: undefined,
                            });
                            const pending = readState(pendingKey);
                            if (pending?.creation?.siteId === site._id)
                                deps.storage.removeItem(pendingKey);
                        } catch {
                            /* Retaining a recovery marker is safe if cleanup is unavailable. */
                        }
                    }
                } else if (
                    site?.status === 'empty' &&
                    !controller.state.siteName
                ) {
                    controller.state.siteName = site.name;
                }
                // Local step data cannot bypass the server's completed-import requirement.
                if (
                    (!site || site.status !== 'ready') &&
                    ['preview', 'publish'].includes(controller.state.step)
                )
                    controller.state.step = controller.state.presetId
                        ? 'content'
                        : 'template';
                changed();
            })();
            try {
                await refreshing;
            } finally {
                refreshing = undefined;
            }
        },
        async loadPlan() {
            if (!deps.scope.admin || !deps.scope.siteId || !currentChoice)
                return;
            const choice = currentChoice;
            const result = await deps.sdk.send<{ plan: ImportPlan }>({
                url: `/api/v4/presets/plan/${encodeURIComponent(choice.id)}${
                    choice.sourceCommit
                        ? `?version=${encodeURIComponent(choice.version)}`
                        : ''
                }`,
                method: 'GET',
                selectorOverride: selector,
            });
            if (
                result.plan.presetId !== choice.id ||
                result.plan.version !== choice.version
            )
                throw new Error('模板版本已变更，请重新选择模板。');
            if (currentChoice === choice) controller.plan = result.plan;
            changed();
        },
        async next(): Promise<boolean> {
            if (controller.busy || !deps.scope.admin) return false;
            if (controller.state.step === 'template') {
                if (!currentChoice) return false;
                controller.state.step = 'identity';
            } else if (controller.state.step === 'identity') {
                if (
                    !controller.state.siteName.trim() ||
                    controller.state.siteName.trim().length > 80
                )
                    return false;
                controller.state.siteName = controller.state.siteName.trim();
                if (!deps.scope.siteId) return withCreationLock(prepareSite);
                await controller.loadPlan();
                controller.state.step = 'content';
            } else if (controller.state.step === 'content') {
                if (controller.site?.status !== 'ready') return false;
                controller.state.step = 'preview';
            } else if (controller.state.step === 'preview') {
                if (controller.site?.status !== 'ready') return false;
                controller.state.step = 'publish';
            } else return false;
            save();
            changed();
            return true;
        },
        back() {
            if (controller.busy) return;
            const index = onboardingSteps.indexOf(controller.state.step);
            const minimum = controller.optionsLocked ? 2 : 0;
            if (index > minimum) {
                controller.state.step = onboardingSteps[index - 1];
                save();
                changed();
            }
        },
        async recoverCreation(siteId: string) {
            if (
                controller.busy ||
                !controller.state.creation ||
                !controller.creationCandidates.some(
                    (item) => item._id === siteId,
                )
            )
                return false;
            controller.state.creation.siteId = siteId;
            save(true);
            return withCreationLock(prepareSite);
        },
        async retryPendingImport() {
            if (!controller.canRetryPendingImport) return;
            await controller.importSite(true);
        },
        async importSite(retryPendingEmpty = false) {
            if (
                controller.busy ||
                !deps.scope.admin ||
                !deps.scope.siteId ||
                controller.state.step !== 'content'
            )
                return;
            controller.busy = true;
            changed();
            try {
                await controller.refresh();
                const site = controller.site;
                if (
                    !site ||
                    site.status === 'ready' ||
                    !controller.state.siteName.trim()
                )
                    return;
                if (
                    site.status === 'empty' &&
                    controller.state.importRequested &&
                    !retryPendingEmpty
                )
                    return;
                if (site.status === 'importing' && !controller.canResume)
                    return;
                const selected = controller.selected;
                if (!selected || selected.id !== controller.state.presetId)
                    return;
                await controller.loadPlan();
                if (
                    !controller.plan ||
                    controller.plan.models.some(
                        (item) => item.action === 'conflict',
                    )
                )
                    return;
                controller.state.importRequested = true;
                save(true);
                changed();
                try {
                    const result = await deps.sdk.send<SiteInstallation>({
                        url: '/api/v4/presets/import',
                        method: 'POST',
                        selectorOverride: selector,
                        data: {
                            presetId: selected.id,
                            siteName: controller.state.siteName.trim(),
                            includeDemo: controller.state.includeDemo,
                            mode: 'import',
                            ...(selected.sourceCommit
                                ? {
                                      presetVersion: selected.version,
                                      manifestChecksum:
                                          selected.manifestChecksum,
                                  }
                                : {}),
                        },
                    });
                    if (result._id !== deps.scope.siteId)
                        throw new Error('网站选择已变更，请重新选择网站。');
                    controller.site = result;
                    await controller.refresh();
                } catch (cause) {
                    const refreshed = await controller.refresh().then(
                        () => true,
                        () => false,
                    );
                    const status = (cause as { status?: number })?.status;
                    if (
                        refreshed &&
                        controller.site?.status === 'empty' &&
                        status &&
                        [400, 401, 403, 404, 422].includes(status)
                    ) {
                        controller.state.importRequested = false;
                        save(false, key, true);
                    }
                    throw cause;
                }
            } finally {
                controller.busy = false;
                changed();
            }
        },
    };
    function readState(storageKey: string): SiteOnboardingState | null {
        const raw = deps.storage.getItem(storageKey);
        if (!raw) return null;
        const saved = JSON.parse(raw);
        if (
            !saved ||
            !onboardingSteps.includes(saved.step) ||
            ![
                'presetId',
                'presetVersion',
                'sourceCommit',
                'manifestChecksum',
                'siteName',
            ].every((field) => typeof saved[field] === 'string') ||
            typeof saved.includeDemo !== 'boolean' ||
            typeof saved.importRequested !== 'boolean' ||
            (saved.creation !== undefined &&
                (!saved.creation ||
                    typeof saved.creation.name !== 'string' ||
                    !Array.isArray(saved.creation.baselineIds) ||
                    !saved.creation.baselineIds.every(
                        (id: unknown) => typeof id === 'string',
                    ) ||
                    (saved.creation.siteId !== undefined &&
                        typeof saved.creation.siteId !== 'string')))
        ) {
            throw new Error('Invalid saved onboarding progress');
        }
        return {
            step: saved.step,
            presetId: saved.presetId,
            presetVersion: saved.presetVersion,
            sourceCommit: saved.sourceCommit,
            manifestChecksum: saved.manifestChecksum,
            siteName: saved.siteName,
            includeDemo: saved.includeDemo,
            importRequested: saved.importRequested,
            ...(saved.creation ? { creation: saved.creation } : {}),
        };
    }
    function changed() {
        deps.onChange?.();
    }
    function save(required = false, targetKey = key, replace = false) {
        try {
            if (storageUnreadable) throw new Error('Unreadable progress');
            if (
                !replace &&
                targetKey === key &&
                !controller.state.creation &&
                !controller.state.importRequested &&
                controller.site?.status !== 'ready'
            ) {
                const pending = readState(key);
                if (pending?.creation || pending?.importRequested)
                    controller.state = pending;
            }
            deps.storage.setItem(targetKey, JSON.stringify(controller.state));
            controller.storageError = false;
        } catch {
            controller.storageError = true;
            if (required)
                throw new Error(
                    '浏览器无法读取或保存本地存储中的恢复进度，请允许本地存储后刷新重试。',
                );
        }
    }
    async function withCreationLock(
        action: () => Promise<boolean>,
    ): Promise<boolean> {
        if (typeof navigator !== 'undefined' && navigator.locks)
            return navigator.locks.request(key, action);
        // Same-document fallback also covers environments without Web Locks.
        const previous = creationLocks.get(key) || Promise.resolve();
        const pending = previous.catch(() => undefined).then(action);
        creationLocks.set(key, pending);
        try {
            return await pending;
        } finally {
            if (creationLocks.get(key) === pending) creationLocks.delete(key);
        }
    }
    async function prepareSite(): Promise<boolean> {
        controller.busy = true;
        changed();
        try {
            // Creation has no server idempotency key. Persist intent before sending and never blindly resend it.
            const saved = readState(key);
            if (saved?.creation) controller.state = saved;
            const pending = controller.state.creation;
            const result = await deps.sdk.send<{ items: SiteInstallation[] }>({
                url: '/api/v4/workspaces/current/sites',
                method: 'GET',
                selectorOverride: { workspaceId: deps.scope.workspaceId },
            });
            let site: SiteInstallation | undefined;
            if (pending) {
                const matches = pending.siteId
                    ? result.items.filter((item) => item._id === pending.siteId)
                    : result.items.filter(
                          (item) =>
                              !pending.baselineIds.includes(item._id) &&
                              item.name === pending.name,
                      );
                if (!pending.siteId || matches.length !== 1) {
                    controller.creationCandidates = matches;
                    controller.creationUncertain = true;
                    changed();
                    return false;
                }
                site = matches[0];
            } else {
                controller.state.creation = {
                    name: controller.state.siteName.trim(),
                    baselineIds: result.items.map((item) => item._id),
                };
                save(true);
                changed();
                site = await deps.sdk.send<SiteInstallation>({
                    url: '/api/v4/workspaces/current/sites',
                    method: 'POST',
                    data: { name: controller.state.creation.name },
                    selectorOverride: { workspaceId: deps.scope.workspaceId },
                });
                controller.state.creation.siteId = site._id;
                save(true);
            }
            controller.state.step = 'content';
            // Keep the origin intent until selection succeeds, and save the selected-site progress before navigation.
            const destinationKey = onboardingStorageKey({
                ...deps.scope,
                siteId: site._id,
            });
            const selectedState = { ...controller.state };
            delete selectedState.creation;
            try {
                deps.storage.setItem(
                    destinationKey,
                    JSON.stringify(selectedState),
                );
            } catch {
                controller.storageError = true;
                throw new Error(
                    '浏览器无法读取或保存本地存储中的恢复进度，请允许本地存储后刷新重试。',
                );
            }
            controller.state.step = 'identity';
            save(true);
            await deps.sdk.selectContext(
                { workspaceId: deps.scope.workspaceId, siteId: site._id },
                '/d/site-setup',
            );
            return true;
        } finally {
            controller.busy = false;
            changed();
        }
    }
    return controller;
}
