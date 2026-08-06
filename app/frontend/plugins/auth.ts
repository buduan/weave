/**
 * 在渲染前补齐内存中的认证状态（profile + actor）。
 *
 * Token 持久化在 Cookie，但 profile / actor 是内存引用，刷新后会丢失。这里在应用
 * 初始化时（服务端渲染 + 客户端）解析一次当前用户的 profile 与 actor（含
 * isSystemAdmin / 权限），让导航等服务端渲染时就拿到正确状态；401 由 API 客户端
 * 统一处理并跳转登录。
 */
export default defineNuxtPlugin(async () => {
  const authStore = useAuthStore();
  if (!authStore.isAuthenticated) return;
  const tasks: Array<Promise<unknown>> = [];
  if (!authStore.profile) tasks.push(authStore.fetchProfile());
  if (!authStore.actor) tasks.push(authStore.fetchActor());
  if (tasks.length === 0) return;
  try {
    await Promise.all(tasks);
  } catch {
    // 忽略：未拿全时按未解析态降级渲染。
  }
});
