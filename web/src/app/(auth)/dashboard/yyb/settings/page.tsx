import type { YybEndpoint } from '@/types/Panel';
import { redirect } from 'next/navigation';
import { Input } from '@/components/ui/input';
import { StateForm } from '@/features/panel/ExpireEditor';
import { Card, PageTitle, Tag } from '@/features/panel/Ui';
import { yybCheckAction, yybSaveEndpointAction } from '@/features/panel/yybActions';
import { panelGet, panelMe } from '@/libs/PanelApi';

export default async function YybSettingsPage() {
  const user = await panelMe();
  if (!user || user.role !== 'admin') {
    redirect('/dashboard/yyb');
  }

  const endpoints = await panelGet<YybEndpoint[]>('/yyb/endpoints');
  const current = endpoints?.[0];

  return (
    <>
      <PageTitle
        title="应用宝 · 设置"
        description="YYB-Go-Enhanced 服务地址与凭据；面板用账号密码建立会话，也可改用免密集成 Token"
      />

      <div className="
        grid gap-4
        lg:grid-cols-2
      "
      >
        <Card
          title="协议服务"
          description="保存后点「测试连接」立即验证"
          actions={(
            <Tag tone={current?.status === 'online' ? 'success' : current?.status === 'offline' ? 'danger' : 'gray'}>
              {current?.status === 'online' ? '在线' : current?.status === 'offline' ? '离线' : '未测'}
            </Tag>
          )}
        >
          <StateForm
            action={yybSaveEndpointAction}
            fields={{ id: current?.id ?? '' }}
            className="flex-col items-stretch gap-3"
            submitLabel="保存配置"
            okLabel="已保存，可点下方「测试连接」"
          >
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              名称
              <Input name="name" defaultValue={current?.name ?? 'YYB 协议服务'} />
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              服务地址
              <Input name="base_url" defaultValue={current?.base_url ?? ''} placeholder="http://127.0.0.1:5844" />
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              用户名
              <Input name="username" defaultValue={current?.username ?? ''} />
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              密码
              <Input
                name="password"
                type="password"
                placeholder={current?.has_password ? '已保存，留空则不修改' : '请输入密码'}
              />
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              免密集成 Token（可选）
              <Input
                name="integration_token"
                placeholder={current?.has_token ? '已保存，留空则不修改' : 'YYB_INTEGRATION_TOKEN'}
              />
              <span className="text-xs text-muted-foreground">
                填了它就走 /integration/* 免密通道；YYB 端未设 YYB_INTEGRATION_TOKEN 时该通道返回 503
              </span>
            </label>
          </StateForm>

          <div className="mt-4 border-t pt-4">
            <StateForm
              action={yybCheckAction}
              fields={{ endpoint_id: current?.id ?? '' }}
              submitLabel="测试连接"
              okLabel="连接成功"
            >
              <span className="text-xs text-muted-foreground">用当前配置探测一次：账号数、青龙连接状态、版本</span>
            </StateForm>
          </div>
        </Card>

        <Card title="对接说明" description="面板与 YYB 的分工">
          <ul className="
            flex list-disc flex-col gap-2 pl-5 text-sm text-muted-foreground
          "
          >
            <li>
              <b className="text-foreground">面板负责调度与呈现</b>
              ：账号存活、凭据倒计时、任务运行、日志检索。
            </li>
            <li>
              <b className="text-foreground">YYB 负责协议</b>
              ：微信登录态、保活续期、
              <code>/wxapp/getCode</code>
              {' '}
              取码、代理出口。
            </li>
            <li>
              脚本取码走 YYB 的
              {' '}
              <code>/wxapp/getCode</code>
              （payload
              {' '}
              <code>{'{ref, app_id}'}</code>
              ）；
              本仓库适配器 V1.4 已原生支持 YYB 注入的
              {' '}
              <code>YYB_SERVER</code>
              。
            </li>
            <li>
              青龙侧脚本订阅后，YYB 会按「账号 × 脚本」克隆任务并注入
              {' '}
              <code>YYB_SERVER</code>
              ，
              任务名前缀
              {' '}
              <code>[YYB:&lt;账号ID&gt;]</code>
              ，日志落在
              {' '}
              <code>yyb_account_&lt;id&gt;_&lt;hash&gt;</code>
              。
            </li>
            <li>
              旧的全库全局任务记得停用，否则会和账号级任务重复跑。
            </li>
          </ul>
        </Card>
      </div>
    </>
  );
}

export const dynamic = 'force-dynamic';
