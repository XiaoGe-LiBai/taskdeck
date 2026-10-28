import { createEnv } from '@t3-oss/env-nextjs';
import * as z from 'zod';

export const Env = createEnv({
  server: {
    /** 后端 API（server/，Flask）地址 */
    PANEL_API_URL: z.string().default('http://127.0.0.1:8100'),
  },
  client: {
    NEXT_PUBLIC_APP_URL: z.string().optional(),
  },
  shared: {
    NODE_ENV: z.enum(['test', 'development', 'production']).optional(),
  },
  // You need to destructure all the keys manually
  runtimeEnv: {
    PANEL_API_URL: process.env.PANEL_API_URL,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NODE_ENV: process.env.NODE_ENV,
  },
});
