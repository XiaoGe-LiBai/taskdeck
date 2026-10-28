/** 用户头像的确定性配色：同一个昵称/邮箱永远得到同一个颜色（避免每次渲染闪色）。 */
export function getAvatarBg(name: string) {
  const colors = [
    'bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/20',
    'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/20',
    'bg-purple-500/15 text-purple-600 dark:text-purple-400 border-purple-500/20',
    'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/20',
    'bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/20',
    'bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 border-indigo-500/20',
  ];
  let hash = 0;
  for (let i = 0; i < (name || '').length; i++) {
    hash = (hash << 5) - hash + name.charCodeAt(i);
  }
  return colors[Math.abs(hash) % colors.length];
}
