import react from '@vitejs/plugin-react';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    // 纯 node 环境的单元测试（组件级 browser 测试已随死代码一并移除）
    include: ['src/**/*.test.{js,ts}'],
    environment: 'node',
    reporters: [
      'default',
      // conditional reporter
      process.env.CI ? 'github-actions' : {},
    ],
    env: {
      ...loadEnv('', process.cwd(), ''), // Expose .env variables to Node.js
    },
  },
  define: {
    'process.env': JSON.stringify(loadEnv('', process.cwd(), 'NEXT_PUBLIC_')), // Expose .env variables to browser
  },
});
