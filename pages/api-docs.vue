<template>
  <div id="scalar-api-reference" />
</template>

<script setup lang="ts">
// Standalone Scalar API reference loaded from CDN.
// Kept out of the app layout and Vite dependency graph on purpose —
// Scalar runs entirely client-side against Nitro's auto-generated OpenAPI spec.
definePageMeta({ layout: false })

useHead({ title: 'EasyWGSync API Docs' })

onMounted(() => {
  const init = document.createElement('script')
  init.id = 'api-reference'
  init.setAttribute('data-url', '/_openapi.json')
  document.body.appendChild(init)

  const lib = document.createElement('script')
  lib.src = 'https://registry.npmmirror.com/@scalar/api-reference/1.60.0/files/dist/browser/standalone.js'
  lib.async = true
  document.body.appendChild(lib)
})
</script>
