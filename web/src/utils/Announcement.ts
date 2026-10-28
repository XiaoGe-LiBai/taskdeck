/**
 * 公告内容安全渲染。
 *
 * 历史原因下公告 content 里可能含 HTML 标签（管理员在文本框里写过 <p> 等）。
 * 面板端不做 HTML 渲染（避免存储型 XSS：管理员账号被盗即成为投递通道），
 * 统一转成纯文本展示；块级标签转成换行，保留基本可读性。
 */
export function announcementText(raw: string): string {
  return (raw ?? '')
    // 先整块去掉 script/style，避免其中文字被当成正文
    .replace(/<\s*(script|style)\b[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    // 显式换行
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    // 块级标签结尾补换行
    .replace(/<\s*\/\s*(p|div|li|h[1-6]|tr|blockquote|ul|ol|table)\s*>/gi, '\n')
    // 其余标签全部剥掉
    .replace(/<[^>]+>/g, '')
    // 常见实体解码
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    // 折叠多余空行
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
