# EasyWGSync

WireGuard Hybrid Mesh 配置分发与拓扑编辑器。

[中文 | [英格丽徐](./README.EN.md)]

---

## 是什么

EasyWGSync 用于管理**Hybrid Mesh WireGuard 网络**，能够在画布上对每个节点的配置和节点之间的连接进行配置，并生成每个节点的wg配置。

该项目通过建立`fullmesh group`概念，允许用户在一个大网络中取一小撮节点互相连接，并且可以单独指定每个节点之间的网关、代理、中转关系。

如果你觉得你不需要TailScale的路由智能配置，想要使用原生Wireguard快速配置每个节点之间的连接与出口，本项目值得一试！

## 快速开始

```bash
# 安装依赖
npm install

# 开发
npm run dev

# 构建 & 生产启动
npm run build
npm run start
```

## 技术栈

- Nuxt 3 
- Vue 3 
- TailwindCSS 
- Vue Flow

## License

GPL-3.0-or-later
