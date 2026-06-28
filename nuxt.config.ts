// Load + validate env (reads .env, fails fast on misconfig) before Nitro boots.
// In dev/build this top-level import runs before Nitro starts, so NITRO_PORT
// below is in process.env before Nitro reads its listen port. In production,
// scripts/start-prod.mjs does the same job (nuxt.config isn't re-evaluated).
import env from './env.js'
process.env.NITRO_PORT ||= String(env.port)

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
    // Register the /_openapi.json + /_scalar routes in production builds too.
    // Without `production`, Nitro only serves them in dev (resolveOpenAPIOptions
    // returns early for non-dev without this), so Scalar 404s in production.
    openAPI: {
      production: 'runtime',
      // Raw spec at an internal path; a custom /_openapi.json route adds
      // x-internal to the Internal/App Routes tags so Scalar hides Nitro's
      // non-API routes.
      route: '/_openapi-raw',
    },
  },

  app: {
    head: {
      title: 'EasyWGSync',
      meta: [
        { name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' },
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
