// Cross-component UI state (frontend-only, not persisted).
// Coordinates header hamburger with off-canvas sidebar at mobile widths.

export function useUiState() {
  const mobileSidebarOpen = useState<boolean>('mobile-sidebar-open', () => false)

  function openSidebar() { mobileSidebarOpen.value = true }
  function closeSidebar() { mobileSidebarOpen.value = false }
  function toggleSidebar() { mobileSidebarOpen.value = !mobileSidebarOpen.value }

  return { mobileSidebarOpen, openSidebar, closeSidebar, toggleSidebar }
}
