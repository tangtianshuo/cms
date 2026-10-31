import {
    defineComponent,
    nextTick,
    onBeforeUnmount,
    onMounted,
    ref,
} from 'vue';
import { RouterLink, useRoute } from 'vue-router';
import { ReleaseManager } from '../../components/storefront/release-manager';
import { StudioIcon } from '../../components/studio/icon';
import { userErrorMessage } from '../../util/user-message';
import {
    createSiteOnboarding,
    onboardingSteps,
    type OnboardingStep,
} from './site-onboarding-state';
import '../../components/studio/studio.css';
import './site-onboarding.css';

const labels: Record<OnboardingStep, string> = {
    template: '选择模板',
    identity: '网站信息',
    content: '准备内容',
    preview: '预览检查',
    publish: '确认发布',
};
const contentLinks = [
    {
        key: 'brand',
        title: '品牌与联系资料',
        detail: '填写品牌名称、联系邮箱与介绍。',
        href: '/d/studio?section=content&modelKey=site-settings',
    },
    {
        key: 'home',
        title: '首页',
        detail: '替换主视觉与首页文案。',
        href: '/d/studio?section=content&modelKey=home',
    },
    {
        key: 'product',
        title: '商品与服务',
        detail: '添加真实商品或服务资料。',
        href: '/d/studio?section=content&modelKey=product',
    },
    {
        key: 'content',
        title: '网站页面',
        detail: '完善关于我们等页面并保存草稿。',
        href: '/d/studio?section=pages',
    },
];

const SiteOnboardingWizard = defineComponent({
    setup() {
        const sdk = window.bcms.sdk;
        const route = useRoute();
        const context = sdk.context?.context;
        const newSite = route.query.new === '1';
        const scope = {
            userId: context?.actorId || sdk.accessToken?.payload.userId || '',
            workspaceId: context?.workspaceId || '',
            siteId: newSite ? undefined : context?.siteId,
            admin: !!context?.admin,
        };
        const revision = ref(0);
        const controller = createSiteOnboarding({
            sdk,
            scope,
            storage: {
                getItem: (key) => window.localStorage.getItem(key),
                setItem: (key, value) =>
                    window.localStorage.setItem(key, value),
                removeItem: (key) => window.localStorage.removeItem(key),
            },
            onChange: () => {
                revision.value++;
            },
        });
        const loading = ref(true);
        const loaded = ref(false);
        const working = ref(false);
        const error = ref('');
        const nameError = ref('');
        const nameInput = ref<HTMLInputElement>();
        const heading = ref<HTMLHeadingElement>();
        const demoView = ref('home');
        const viewport = ref<'desktop' | 'mobile'>('desktop');
        let timer: ReturnType<typeof setInterval> | undefined;
        let disposed = false;
        let languageSelected = false;
        let origin = '';
        try {
            origin = import.meta.env.VITE_STOREFRONT_ORIGIN
                ? new URL(import.meta.env.VITE_STOREFRONT_ORIGIN).origin
                : '';
        } catch {
            /* The cover remains available when a demo renderer is not configured. */
        }

        async function selectLanguage() {
            if (languageSelected || controller.site?.status !== 'ready') return;
            await sdk.language.getAll({ skipCache: true });
            await sdk.template.getAll({ skipCache: true });
            window.bcms.useLanguage()[1](controller.site.language || 'en');
            languageSelected = true;
        }
        async function refresh() {
            await controller.refresh();
            await selectLanguage();
        }
        async function run(action: () => Promise<unknown>) {
            if (working.value || controller.busy) return;
            working.value = true;
            error.value = '';
            try {
                await action();
            } catch (cause) {
                error.value = userErrorMessage(cause);
            } finally {
                working.value = false;
            }
        }
        async function load() {
            loading.value = true;
            await run(async () => {
                await controller.load();
                await selectLanguage();
                loaded.value = true;
            });
            loading.value = false;
        }
        async function next() {
            await run(async () => {
                if (await controller.next()) {
                    await nextTick();
                    heading.value?.focus?.();
                }
            });
        }
        function validateName() {
            nameError.value = !controller.state.siteName.trim()
                ? '请填写网站名称。'
                : controller.state.siteName.trim().length > 80
                ? '网站名称最多 80 个字符。'
                : '';
            return !nameError.value;
        }
        async function submitIdentity(event: Event) {
            event.preventDefault();
            if (!validateName()) {
                nameInput.value?.focus?.();
                return;
            }
            await next();
        }
        onMounted(async () => {
            await load();
            if (disposed) return;
            timer = setInterval(() => {
                if (!working.value && controller.importing) run(refresh);
            }, 3000);
        });
        onBeforeUnmount(() => {
            disposed = true;
            if (timer) clearInterval(timer);
        });

        return () => {
            void revision.value;
            const state = controller.state;
            const site = controller.site;
            const selected = controller.selected;
            const busy = working.value || controller.busy;
            const index = onboardingSteps.indexOf(state.step);
            const conflicts =
                controller.plan?.models.filter(
                    (item) => item.action === 'conflict',
                ) || [];
            const previewSrc = scope.siteId
                ? `/d/presets/site-preview?workspaceId=${encodeURIComponent(
                      scope.workspaceId,
                  )}&siteId=${encodeURIComponent(scope.siteId)}`
                : '';
            const demoSrc =
                selected && !selected.sourceCommit && origin
                    ? `${origin}/presets/${encodeURIComponent(
                          selected.id,
                      )}?view=${demoView.value}`
                    : '';
            return (
                <div class="cms-studio site-setup">
                    <header class="studio-header">
                        <div>
                            <p class="studio-eyebrow">CREATE YOUR WEBSITE</p>
                            <h1>创建网站</h1>
                            <p class="studio-subtitle">
                                选择喜欢的样式，准备内容，预览后再发布。进度会保存在当前浏览器。
                            </p>
                        </div>
                        <RouterLink
                            class="studio-button"
                            to="/d/studio?section=overview"
                        >
                            返回工作台
                        </RouterLink>
                    </header>
                    <p class="site-setup-context">
                        <strong>{sdk.context?.workspace.name}</strong>
                        <span>
                            {' '}
                            /{' '}
                            {state.siteName ||
                                (newSite
                                    ? '新网站'
                                    : sdk.context?.site?.name || '新网站')}
                        </span>
                    </p>
                    {error.value && (
                        <p class="studio-error" role="alert">
                            {error.value}
                        </p>
                    )}
                    {controller.storageError && (
                        <p class="studio-warning" role="alert">
                            无法读取或保存本地存储中的进度。请允许此网站使用本地存储后刷新，再继续创建。
                        </p>
                    )}
                    {!scope.admin ? (
                        <section class="studio-card studio-empty">
                            <h2>创建网站需要管理员权限</h2>
                            <p>
                                请联系当前工作区管理员创建网站。已有内容仍可在工作台管理。
                            </p>
                        </section>
                    ) : loading.value ? (
                        <p role="status" class="studio-card">
                            正在读取网站创建进度…
                        </p>
                    ) : !loaded.value ? (
                        <section class="studio-card">
                            <p>未能读取创建进度，请重试。</p>
                            <button type="button" onClick={load}>
                                重新读取
                            </button>
                        </section>
                    ) : (
                        <>
                            <ol
                                class="site-setup-steps"
                                aria-label="网站创建进度"
                            >
                                {onboardingSteps.map((step, stepIndex) => (
                                    <li
                                        key={step}
                                        aria-current={
                                            state.step === step
                                                ? 'step'
                                                : undefined
                                        }
                                        class={{
                                            active: stepIndex === index,
                                            complete: stepIndex < index,
                                        }}
                                    >
                                        <span aria-hidden="true">
                                            {stepIndex + 1}
                                        </span>
                                        <strong>{labels[step]}</strong>
                                    </li>
                                ))}
                            </ol>
                            {controller.registryUnavailable && (
                                <p class="studio-warning" role="status">
                                    暂时无法读取公开模板目录，仍可选择内置模板。稍后刷新可重新检查。
                                </p>
                            )}
                            <section
                                class="studio-card site-setup-stage"
                                aria-busy={busy}
                            >
                                <div class="studio-card-heading">
                                    <div>
                                        <p class="studio-help">
                                            第 {index + 1} 步，共 5 步
                                        </p>
                                        <h2 ref={heading} tabindex={-1}>
                                            {labels[state.step]}
                                        </h2>
                                    </div>
                                    {busy && (
                                        <span role="status" class="studio-help">
                                            正在处理，请稍候…
                                        </span>
                                    )}
                                </div>
                                {state.step === 'template' && (
                                    <>
                                        <p class="studio-help">
                                            样式决定页面外观。选择后还可以替换文案、图片和品牌颜色。
                                        </p>
                                        <div class="site-setup-template-layout">
                                            <div
                                                class="site-setup-catalog"
                                                aria-label="可选网站模板"
                                            >
                                                {controller.catalog.map(
                                                    (item) => (
                                                        <button
                                                            key={`${item.id}@${
                                                                item.version
                                                            }:${
                                                                item.sourceCommit ||
                                                                ''
                                                            }`}
                                                            class="site-setup-template"
                                                            type="button"
                                                            disabled={busy}
                                                            aria-pressed={
                                                                state.presetId ===
                                                                    item.id &&
                                                                state.presetVersion ===
                                                                    item.version &&
                                                                state.sourceCommit ===
                                                                    (item.sourceCommit ||
                                                                        '')
                                                            }
                                                            onClick={() => {
                                                                controller.chooseTemplate(
                                                                    item,
                                                                );
                                                                demoView.value =
                                                                    'home';
                                                            }}
                                                        >
                                                            <img
                                                                src={
                                                                    item.heroImage
                                                                }
                                                                alt=""
                                                                loading="lazy"
                                                            />
                                                            <span>
                                                                <strong>
                                                                    {item.name}
                                                                </strong>
                                                                <small>
                                                                    版本{' '}
                                                                    {
                                                                        item.version
                                                                    }
                                                                </small>
                                                                <span>
                                                                    {
                                                                        item.description
                                                                    }
                                                                </span>
                                                            </span>
                                                        </button>
                                                    ),
                                                )}
                                                {!controller.catalog.length && (
                                                    <p class="studio-help">
                                                        暂无可选模板，请稍后重试。
                                                    </p>
                                                )}
                                            </div>
                                            <div class="site-setup-demo">
                                                {selected ? (
                                                    <>
                                                        <div class="studio-card-heading">
                                                            <h3>
                                                                {selected.name}
                                                            </h3>
                                                            {demoSrc && (
                                                                <div
                                                                    class="studio-actions"
                                                                    role="group"
                                                                    aria-label="模板预览尺寸"
                                                                >
                                                                    {(
                                                                        [
                                                                            'desktop',
                                                                            'mobile',
                                                                        ] as const
                                                                    ).map(
                                                                        (
                                                                            mode,
                                                                        ) => (
                                                                            <button
                                                                                type="button"
                                                                                aria-pressed={
                                                                                    viewport.value ===
                                                                                    mode
                                                                                }
                                                                                onClick={() => {
                                                                                    viewport.value =
                                                                                        mode;
                                                                                }}
                                                                            >
                                                                                {mode ===
                                                                                'desktop'
                                                                                    ? '桌面'
                                                                                    : '手机'}
                                                                            </button>
                                                                        ),
                                                                    )}
                                                                </div>
                                                            )}
                                                        </div>
                                                        {demoSrc && (
                                                            <div
                                                                class="site-setup-demo-tabs"
                                                                role="group"
                                                                aria-label="模板示例页面"
                                                            >
                                                                {[
                                                                    {
                                                                        key: 'home',
                                                                        label: '首页',
                                                                    },
                                                                    {
                                                                        key: 'collection',
                                                                        label: '分类',
                                                                    },
                                                                    {
                                                                        key: 'product',
                                                                        label: '商品',
                                                                    },
                                                                    {
                                                                        key: 'page',
                                                                        label: '内容页',
                                                                    },
                                                                ].map(
                                                                    (view) => (
                                                                        <button
                                                                            type="button"
                                                                            aria-pressed={
                                                                                demoView.value ===
                                                                                view.key
                                                                            }
                                                                            onClick={() => {
                                                                                demoView.value =
                                                                                    view.key;
                                                                            }}
                                                                        >
                                                                            {
                                                                                view.label
                                                                            }
                                                                        </button>
                                                                    ),
                                                                )}
                                                            </div>
                                                        )}
                                                        <div class="site-setup-demo-frame">
                                                            {demoSrc ? (
                                                                <iframe
                                                                    title={`${selected.name} 模板示例`}
                                                                    src={
                                                                        demoSrc
                                                                    }
                                                                    style={{
                                                                        width:
                                                                            viewport.value ===
                                                                            'mobile'
                                                                                ? '390px'
                                                                                : '100%',
                                                                        maxWidth:
                                                                            '100%',
                                                                    }}
                                                                />
                                                            ) : (
                                                                <img
                                                                    src={
                                                                        selected.heroImage
                                                                    }
                                                                    alt={`${selected.name} 模板封面`}
                                                                />
                                                            )}
                                                        </div>
                                                        <p class="studio-help">
                                                            {selected.sourceCommit
                                                                ? '这里展示模板封面。创建草稿后，将使用实际内容检查可用的预览服务。'
                                                                : demoSrc
                                                                ? '这里展示模板示例，实际网站内容会在后续步骤中配置。'
                                                                : '这里展示模板封面，示例预览服务尚未配置。'}
                                                        </p>
                                                    </>
                                                ) : (
                                                    <div class="site-setup-placeholder">
                                                        <StudioIcon
                                                            name="pages"
                                                            size={32}
                                                        />
                                                        <p>
                                                            选择一个模板，查看样式与说明。
                                                        </p>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </>
                                )}
                                {state.step === 'identity' && (
                                    <form
                                        id="site-setup-identity"
                                        onSubmit={submitIdentity}
                                        novalidate
                                    >
                                        <div class="studio-fields">
                                            <label for="site-setup-name">
                                                网站名称
                                                <input
                                                    ref={nameInput}
                                                    id="site-setup-name"
                                                    type="text"
                                                    autocomplete="organization"
                                                    required
                                                    maxlength={80}
                                                    value={state.siteName}
                                                    disabled={
                                                        busy ||
                                                        controller.optionsLocked
                                                    }
                                                    aria-invalid={
                                                        !!nameError.value
                                                    }
                                                    aria-describedby={
                                                        nameError.value
                                                            ? 'site-setup-name-error'
                                                            : 'site-setup-name-hint'
                                                    }
                                                    onBlur={validateName}
                                                    onInput={(event) => {
                                                        controller.update({
                                                            siteName: (
                                                                event.target as HTMLInputElement
                                                            ).value,
                                                        });
                                                        if (nameError.value)
                                                            validateName();
                                                    }}
                                                />
                                            </label>
                                            {nameError.value ? (
                                                <p
                                                    id="site-setup-name-error"
                                                    class="site-setup-field-error"
                                                    role="alert"
                                                >
                                                    {nameError.value}
                                                </p>
                                            ) : (
                                                <p
                                                    id="site-setup-name-hint"
                                                    class="studio-help"
                                                >
                                                    用品牌或项目名称命名，之后可在网站设置中修改。
                                                </p>
                                            )}
                                        </div>
                                        {state.creation && (
                                            <div
                                                class="site-setup-notice"
                                                role="status"
                                            >
                                                <h3>正在恢复上次的网站创建</h3>
                                                <p>
                                                    请检查创建结果。若响应曾中断，需要确认继续使用哪个网站。
                                                </p>
                                                {controller.creationUncertain && (
                                                    <>
                                                        <p>
                                                            尚未确认原请求对应的网站，请核对下列新出现的同名网站，或在网站管理中检查。
                                                        </p>
                                                        {controller.creationCandidates.map(
                                                            (candidate) => (
                                                                <button
                                                                    key={
                                                                        candidate._id
                                                                    }
                                                                    type="button"
                                                                    disabled={
                                                                        busy
                                                                    }
                                                                    onClick={() =>
                                                                        run(
                                                                            () =>
                                                                                controller.recoverCreation(
                                                                                    candidate._id,
                                                                                ),
                                                                        )
                                                                    }
                                                                >
                                                                    继续设置「
                                                                    {
                                                                        candidate.name
                                                                    }
                                                                    」 ·{' '}
                                                                    {new Date(
                                                                        candidate.createdAt,
                                                                    ).toLocaleString()}
                                                                </button>
                                                            ),
                                                        )}
                                                        <RouterLink
                                                            class="studio-text-link"
                                                            to="/d/workspaces"
                                                        >
                                                            打开网站管理 →
                                                        </RouterLink>
                                                    </>
                                                )}
                                            </div>
                                        )}
                                    </form>
                                )}
                                {state.step === 'content' && (
                                    <>
                                        <p class="site-setup-summary">
                                            <strong>{state.siteName}</strong>
                                            <span>
                                                {selected?.name ||
                                                    state.presetId}{' '}
                                                · 版本 {state.presetVersion}
                                            </span>
                                        </p>
                                        {site?.status === 'ready' ? (
                                            <>
                                                <div
                                                    class="site-setup-notice"
                                                    role="status"
                                                >
                                                    <h3>
                                                        内容已准备，继续完善你的资料
                                                    </h3>
                                                    <p>
                                                        打开下列内容并保存草稿，完成后回到这里继续。示例内容请替换为真实资料。
                                                    </p>
                                                </div>
                                                <div class="site-setup-content-links">
                                                    {contentLinks.map(
                                                        (item) => {
                                                            const check =
                                                                controller.checklist.find(
                                                                    (check) =>
                                                                        check.key ===
                                                                        item.key,
                                                                );
                                                            return (
                                                                <RouterLink
                                                                    key={
                                                                        item.key
                                                                    }
                                                                    class="site-setup-content-link"
                                                                    to={
                                                                        item.href
                                                                    }
                                                                >
                                                                    <span>
                                                                        <strong>
                                                                            {
                                                                                item.title
                                                                            }
                                                                        </strong>
                                                                        <small>
                                                                            {
                                                                                item.detail
                                                                            }
                                                                        </small>
                                                                    </span>
                                                                    <span class="studio-help">
                                                                        {check?.complete
                                                                            ? '已填写'
                                                                            : '去完善'}{' '}
                                                                        <StudioIcon
                                                                            name="arrow"
                                                                            size={
                                                                                16
                                                                            }
                                                                        />
                                                                    </span>
                                                                </RouterLink>
                                                            );
                                                        },
                                                    )}
                                                </div>
                                                <button
                                                    type="button"
                                                    disabled={busy}
                                                    onClick={() => run(refresh)}
                                                >
                                                    重新检查内容
                                                </button>
                                            </>
                                        ) : (
                                            <>
                                                <label class="site-setup-demo-option">
                                                    <input
                                                        type="checkbox"
                                                        checked={
                                                            state.includeDemo
                                                        }
                                                        disabled={
                                                            busy ||
                                                            controller.optionsLocked
                                                        }
                                                        onChange={(event) =>
                                                            controller.update({
                                                                includeDemo: (
                                                                    event.target as HTMLInputElement
                                                                ).checked,
                                                            })
                                                        }
                                                    />
                                                    <span>
                                                        <strong>
                                                            加入示例内容
                                                        </strong>
                                                        <small>
                                                            用示例文案体验页面结构。也可从空白内容开始，之后填写真实资料。
                                                        </small>
                                                    </span>
                                                </label>
                                                {controller.importing && (
                                                    <div
                                                        class="site-setup-notice"
                                                        role="status"
                                                    >
                                                        <h3>
                                                            {site?.status ===
                                                            'importing'
                                                                ? '正在准备网站草稿…'
                                                                : '正在核对上次创建草稿的结果…'}
                                                        </h3>
                                                        <p>
                                                            可以离开后再回来，向导会继续读取这个网站的状态。
                                                        </p>
                                                        <button
                                                            type="button"
                                                            disabled={busy}
                                                            onClick={() =>
                                                                run(refresh)
                                                            }
                                                        >
                                                            检查当前状态
                                                        </button>
                                                    </div>
                                                )}
                                                {controller.canRetryPendingImport && (
                                                    <div class="site-setup-notice">
                                                        <p>
                                                            若上次请求未送达，可用原来的模板与内容选项重新检查并重试。
                                                        </p>
                                                        <button
                                                            class="primary"
                                                            type="button"
                                                            disabled={
                                                                busy ||
                                                                !selected ||
                                                                !!conflicts.length ||
                                                                controller.storageError
                                                            }
                                                            onClick={() =>
                                                                run(
                                                                    async () => {
                                                                        await controller.retryPendingImport();
                                                                        await selectLanguage();
                                                                    },
                                                                )
                                                            }
                                                        >
                                                            重新检查并重试
                                                        </button>
                                                    </div>
                                                )}
                                                {site?.status === 'failed' && (
                                                    <p
                                                        class="studio-error"
                                                        role="alert"
                                                    >
                                                        网站草稿未能准备完成。
                                                        {site.importError
                                                            ? userErrorMessage(
                                                                  site.importError,
                                                              )
                                                            : '请重新检查后继续。'}
                                                    </p>
                                                )}
                                                {!selected && (
                                                    <p
                                                        role="alert"
                                                        class="studio-warning"
                                                    >
                                                        当前选择的模板版本暂不可用，请回到模板选择，或在模板管理中查看已有版本。
                                                    </p>
                                                )}
                                                {!!conflicts.length && (
                                                    <p
                                                        class="studio-warning"
                                                        role="alert"
                                                    >
                                                        当前内容与模板存在冲突，请展开下方检查详情。
                                                    </p>
                                                )}
                                                {site?.status === 'empty' &&
                                                    !state.importRequested && (
                                                        <button
                                                            class="primary"
                                                            type="button"
                                                            disabled={
                                                                busy ||
                                                                !selected ||
                                                                !!conflicts.length ||
                                                                controller.storageError
                                                            }
                                                            onClick={() =>
                                                                run(
                                                                    async () => {
                                                                        await controller.importSite();
                                                                        await selectLanguage();
                                                                    },
                                                                )
                                                            }
                                                        >
                                                            创建网站草稿
                                                        </button>
                                                    )}
                                                {controller.canResume && (
                                                    <button
                                                        class="primary"
                                                        type="button"
                                                        disabled={
                                                            busy ||
                                                            !selected ||
                                                            !!conflicts.length
                                                        }
                                                        onClick={() =>
                                                            run(async () => {
                                                                await controller.importSite();
                                                                await selectLanguage();
                                                            })
                                                        }
                                                    >
                                                        恢复准备网站草稿
                                                    </button>
                                                )}
                                                {!site && (
                                                    <p
                                                        role="alert"
                                                        class="studio-warning"
                                                    >
                                                        尚未找到当前网站，请在网站管理中重新选择。
                                                    </p>
                                                )}
                                            </>
                                        )}
                                    </>
                                )}
                                {state.step === 'preview' && (
                                    <>
                                        <p class="studio-help">
                                            检查页面文案、图片和链接。预览服务的可用状态会在下方显示；发现问题可返回内容步骤修改。
                                        </p>
                                        <a
                                            class="studio-text-link"
                                            href={previewSrc}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                        >
                                            在新窗口预览草稿{' '}
                                            <StudioIcon
                                                name="external"
                                                size={14}
                                            />
                                        </a>
                                        <iframe
                                            class="site-setup-site-preview"
                                            title="网站草稿预览"
                                            src={previewSrc}
                                        />
                                        <p class="studio-help">
                                            确认内容后，进入发布步骤检查本次变更。
                                        </p>
                                    </>
                                )}
                                {state.step === 'publish' && (
                                    <>
                                        <p class="studio-help">
                                            先检查本次修改，再确认发布。发布结果与可访问状态以下方实际检查为准。
                                        </p>
                                        <ReleaseManager onSaved={refresh} />
                                    </>
                                )}
                                <footer class="site-setup-footer">
                                    <button
                                        type="button"
                                        disabled={
                                            busy ||
                                            index <=
                                                (controller.optionsLocked
                                                    ? 2
                                                    : 0)
                                        }
                                        onClick={() => controller.back()}
                                    >
                                        上一步
                                    </button>
                                    <span class="studio-help">
                                        进度自动保存在当前用户、工作区和网站中
                                    </span>
                                    {state.step === 'identity' ? (
                                        <button
                                            class="primary"
                                            type="submit"
                                            form="site-setup-identity"
                                            disabled={
                                                busy || controller.storageError
                                            }
                                        >
                                            {state.creation
                                                ? '检查创建结果'
                                                : '下一步'}
                                        </button>
                                    ) : (
                                        state.step !== 'publish' && (
                                            <button
                                                class="primary"
                                                type="button"
                                                disabled={
                                                    busy ||
                                                    (state.step ===
                                                        'template' &&
                                                        !selected) ||
                                                    (state.step === 'content' &&
                                                        site?.status !==
                                                            'ready')
                                                }
                                                onClick={next}
                                            >
                                                下一步
                                                <StudioIcon
                                                    name="arrow"
                                                    size={15}
                                                />
                                            </button>
                                        )
                                    )}
                                </footer>
                            </section>
                            <details class="studio-card site-setup-advanced">
                                <summary>高级检查与模板管理</summary>
                                {controller.plan && (
                                    <>
                                        <p class="studio-help">
                                            以下内容用于排查网站初始化问题。
                                        </p>
                                        <ul>
                                            {controller.plan.models.map(
                                                (item) => (
                                                    <li key={item.key}>
                                                        {item.name || item.key}{' '}
                                                        ·{' '}
                                                        {
                                                            {
                                                                create: '待建立',
                                                                reuse: '可复用',
                                                                update: '待更新',
                                                                conflict:
                                                                    '存在冲突',
                                                            }[item.action]
                                                        }
                                                        {item.reason && (
                                                            <span role="alert">
                                                                {' '}
                                                                ·{' '}
                                                                {userErrorMessage(
                                                                    item.reason,
                                                                )}
                                                            </span>
                                                        )}
                                                    </li>
                                                ),
                                            )}
                                        </ul>
                                    </>
                                )}
                                {controller.checklist.length > 0 && (
                                    <ul>
                                        {controller.checklist.map((check) => (
                                            <li key={check.key}>
                                                {
                                                    {
                                                        theme: '网站样式',
                                                        brand: '品牌资料',
                                                        product: '商品资料',
                                                        collection: '分类',
                                                        home: '首页',
                                                        content: '内容页面',
                                                        publish: '发布',
                                                    }[check.key]
                                                }{' '}
                                                ·{' '}
                                                {check.complete
                                                    ? '已完成'
                                                    : check.available
                                                    ? '待完善'
                                                    : '暂不可用'}
                                            </li>
                                        ))}
                                    </ul>
                                )}
                                <RouterLink
                                    class="studio-text-link"
                                    to="/d/presets"
                                >
                                    打开模板管理与兼容性检查 →
                                </RouterLink>
                                <RouterLink
                                    class="studio-text-link"
                                    to="/d/workspaces"
                                >
                                    管理工作区与网站 →
                                </RouterLink>
                            </details>
                        </>
                    )}
                </div>
            );
        };
    },
});
export const SiteOnboardingView = defineComponent({
    setup() {
        const route = useRoute();
        return () => (
            <SiteOnboardingWizard
                key={route.query.new === '1' ? 'new' : 'selected'}
            />
        );
    },
});
export default SiteOnboardingView;
