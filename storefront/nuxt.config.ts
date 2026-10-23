export default defineNuxtConfig({
    css: ['~/assets/main.css'],
    runtimeConfig: {
        cmsInternalOrigin: process.env.NUXT_CMS_INTERNAL_ORIGIN || 'http://localhost:8080',
        public: {
            siteHost: process.env.NUXT_PUBLIC_SITE_HOST || 'localhost:3000',
            adminOrigin: process.env.NUXT_PUBLIC_ADMIN_ORIGIN || 'http://localhost:8080',
        },
    },
    routeRules: {
        '/preview': {
            headers: {
                'x-robots-tag': 'noindex, nofollow',
                'cache-control': 'no-store',
            },
        },
        '/presets/**': {
            headers: {
                'x-robots-tag': 'noindex, nofollow',
            },
        },
    },
});
