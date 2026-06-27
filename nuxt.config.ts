export default defineNuxtConfig({
  devtools: { enabled: true },

  modules: [
    '@nuxtjs/tailwindcss',
    '@vueuse/nuxt',
  ],

  components: {
    dirs: [
      { path: '~/components', pathPrefix: false },
    ],
  },

  css: ['~/assets/css/main.css'],

  runtimeConfig: {
    secret: '',
    wireguardConfigName: '',
    wireguardDashboardUrl: '',
    wireguardDashboardApiKey: '',
    casdoorIssuer: '',
    casdoorClientId: '',
    casdoorClientSecret: '',
    casdoorRedirectUri: '', // optional override; empty = auto-detect from request host
    sessionSecret: '',
  },

  nitro: {
    preset: 'node-server',
    experimental: {
      openAPI: true,
    },
  },

  app: {
    head: {
      title: 'EasyWGSync',
      meta: [
        { name: 'format-detection', content: 'telephone=no,address=no,email=no' },
      ],
      link: [
        { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
        { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' },
        { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500&display=swap' },
      ],
    },
  },

  compatibilityDate: '2024-07-01',
})
