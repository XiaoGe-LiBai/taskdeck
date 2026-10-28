import type { NextConfig } from 'next';
import withBundleAnalyzer from '@next/bundle-analyzer';
import './src/libs/Env';

// 基础 Next.js 配置
const baseConfig: NextConfig = {
  devIndicators: {
    position: 'bottom-right',
  },
  poweredByHeader: false,
  reactStrictMode: true,
  reactCompiler: process.env.NODE_ENV === 'production', // 保持开发环境快速
  logging: {
    browserToTerminal: process.env.BROWSER_TO_TERMINAL_DISABLED !== 'true',
  },
  // 本地用 127.0.0.1 / 局域网 IP 访问开发服务器时，允许 Next 开发资源跨源
  allowedDevOrigins: ['127.0.0.1', 'localhost', '127.0.0.1'],
  // Docker 构建时设为 standalone，产出可独立运行的 .next/standalone（镜像无需 node_modules）
  output: process.env.NEXT_OUTPUT_STANDALONE === 'true' ? 'standalone' : undefined,
};

// 按需启用 bundle 分析
export default process.env.ANALYZE === 'true'
  ? withBundleAnalyzer()(baseConfig)
  : baseConfig;
