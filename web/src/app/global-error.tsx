'use client';

import NextError from 'next/error';

/** 全局错误边界：仅渲染 Next 默认错误页（无第三方监控） */
export default function GlobalError() {
  return (
    <html lang="zh-CN">
      <body>
        {/* App Router 不暴露状态码，传 0 渲染通用错误页 */}
        <NextError statusCode={0} />
      </body>
    </html>
  );
}
