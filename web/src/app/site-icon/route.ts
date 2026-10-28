import { PANEL_API_URL } from '@/libs/PanelApi';

/**
 * 把后端的自定义站点图标转发给浏览器（页面 logo、favicon、apple-touch-icon 都走这里）。
 *
 * 为什么不直接在后端地址上引用：`PANEL_API_URL` 是 127.0.0.1:8100，那是 Next 进程
 * 和后端之间的内部地址，用户的浏览器根本访问不到。所以必须由 Next 转一手。
 *
 * 缓存：后端给的 URL 带 `?v=<文件 mtime>`，换图后 v 会变，所以带 v 时可以放心
 * 长缓存；不带 v（用户手敲地址）时给个短缓存，免得换了图一直看到旧图。
 */
export async function GET(request: Request) {
  const hasVersion = new URL(request.url).searchParams.has('v');

  let upstream: Response;
  try {
    upstream = await fetch(`${PANEL_API_URL}/api/site-logo`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    return new Response('backend unreachable', { status: 502 });
  }

  if (!upstream.ok) {
    // 没设置自定义图标（或后端不可达）：给 404，让 <img> 自己走兜底
    return new Response('no custom logo', { status: 404 });
  }

  return new Response(await upstream.arrayBuffer(), {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': hasVersion
        ? 'public, max-age=31536000, immutable'
        : 'public, max-age=60',
    },
  });
}
