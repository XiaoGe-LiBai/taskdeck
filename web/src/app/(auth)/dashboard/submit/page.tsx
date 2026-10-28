import { redirect } from 'next/navigation';

/** 旧「自助提交」路由已并入项目市场，统一重定向到 /dashboard/market */
export default function SubmitRedirectPage() {
  redirect('/dashboard/market');
}
