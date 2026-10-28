/** 登录/注册所在的布局分组：不再依赖第三方鉴权，登录态由 cookie 承载。 */
export default async function AuthLayout(props: {
  children: React.ReactNode;
}) {
  return <>{props.children}</>;
}
