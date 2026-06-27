// Cross-component UI state (frontend-only, not persisted).
//
// mobileSidebarOpen coordinates the header hamburger (layouts/default.vue) with
// the off-canvas Mesh Groups sidebar (pages/graph.vue). At lg+ the sidebar is
// static and this flag is ignored.
export function useUiState() {
  const mobileSidebarOpen = useState<boolean>('mobile-sidebar-open', () => false)

  function openSidebar() { mobileSidebarOpen.value = true }
  function closeSidebar() { mobileSidebarOpen.value = false }
  function toggleSidebar() { mobileSidebarOpen.value = !mobileSidebarOpen.value }

  return { mobileSidebarOpen, openSidebar, closeSidebar, toggleSidebar }
}
