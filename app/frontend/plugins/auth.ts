/**
 * 在渲染前补齐内存中的认证 profile。
 *
 * Token 持久化在 Cookie，但 profile 是内存引用，刷新后会丢失。这里在应用初始化
 * 时（服务端渲染 + 客户端）解析一次当前用户的 profile（含 isSystemAdmin），让
 * 导航等服务端渲染时就拿到正确状态；401 由 API 客户端统一处理并跳转登录。
 */
export default defineNuxtPlugin(async () => {
  const authStore = useAuthStore();
  if (!authStore.isAuthenticated || authStore.profile) return;
  try {
    await authStore.fetchProfile();
  } catch {
    // 忽略：未拿到 profile 时按未解析态降级渲染。
  }
});
