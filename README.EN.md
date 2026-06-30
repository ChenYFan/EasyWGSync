# EasyWGSync

WireGuard Hybrid Mesh configuration distribution & topology editor.

[[Triness](./README.md) | English]

---

## What is it

EasyWGSync manages **Hybrid Mesh WireGuard networks** — configure every node and every node-to-node connection on a visual canvas, and generate per-node WireGuard configs.

Built around the concept of **fullmesh groups**: carve out a subset of nodes within a large network to fully interconnect, while independently specifying gateway, proxy, and relay relationships between any pair.

If you want native WireGuard control over node-to-node routing and exits — without Tailscale's auto-magic — this is for you.

## Quick Start

```bash
# Install dependencies
npm install

# Development
npm run dev

# Build & production
npm run build
npm run start
```

## Tech Stack

- Nuxt 3
- Vue 3
- TailwindCSS
- Vue Flow

## License

GPL-3.0-or-later
