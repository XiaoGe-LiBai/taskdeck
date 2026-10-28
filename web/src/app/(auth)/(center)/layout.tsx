import { CenteredContainer } from '@/features/dashboard/CenteredContainer';

/** 居中布局：为登录/注册等认证页面提供垂直水平居中容器。 */
export default async function CenteredLayout(props: {
  children: React.ReactNode;
}) {
  return (
    <CenteredContainer>{props.children}</CenteredContainer>
  );
}
