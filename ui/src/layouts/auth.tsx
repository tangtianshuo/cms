import { defineComponent } from 'vue';
import { UiLanguageSwitch } from '../components/ui-language-switch';
export const AuthLayout = defineComponent({
    setup(_, ctx) {
        return () => <div class="cms-auth"><UiLanguageSwitch class="cms-auth-language" /><div class="cms-wordmark"><span class="cms-brand-symbol" aria-hidden="true">c<span /></span><strong>cms<span> studio</span></strong></div><div class="cms-auth-card">{ctx.slots.default?.()}</div><p class="cms-auth-caption">CMS Studio · 让内容管理回归简单</p></div>;
    },
});
