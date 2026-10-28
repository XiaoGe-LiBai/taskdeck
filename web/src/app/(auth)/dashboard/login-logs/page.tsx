import { AnimatedList } from '@/components/reactbits';
import { Card, CountValue, PageTitle, StatCard, Table, Tag, Td } from '@/features/panel/Ui';
import { panelGet, panelMe } from '@/libs/PanelApi';

type LoginLog = {
  id: number;
  user_id: number;
  ip: string;
  user_agent: string;
  status: string;
  created_time: string;
};

type LoginLogsPayload = {
  records: LoginLog[];
  total: number;
};

export default async function LoginLogsPage() {
  const [me, logsData] = await Promise.all([
    panelMe(),
    panelGet<LoginLogsPayload>('/auth/login-logs'),
  ]);

  const records = logsData?.records ?? [];
  const latestLog = records[0];

  return (
    <>
      <PageTitle
        title="登陆记录"
        description="查看您的账号最近安全登录记录与设备 IP 信息，保障账号安全"
      />

      <AnimatedList
        stagger={60}
        className="
          mb-6 grid gap-4
          sm:grid-cols-3
        "
      >
        <StatCard
          label="登录历史总计"
          value={<CountValue value={logsData?.total ?? records.length} suffix="次" />}
          hint="记录最近登录行为"
          icon="🛡️"
        />
        <StatCard
          label="上次登录 IP"
          value={latestLog?.ip || me?.last_login_ip || '暂无记录'}
          hint="当前登录位置"
          icon="🌐"
          plain
        />
        <StatCard
          label="账号状态"
          value={me?.status === 'normal' ? '正常激活' : '受限'}
          hint={`登录账号：${me?.email ?? '-'}`}
          icon="✅"
          plain
        />
      </AnimatedList>

      <Card
        title="安全登录流水"
        description="显示账号最近的登录时间、IP 地址与客户端设备，若发现异常登录请及时修改密码"
      >
        {records.length === 0
          ? (
              <div className="py-8 text-center text-sm text-muted-foreground">暂无登录记录</div>
            )
          : (
              <Table head={['登录时间', 'IP 地址', '客户端 / 浏览器环境', '状态']}>
                {records.map(log => (
                  <tr key={log.id}>
                    <Td className="font-mono text-xs">
                      {log.created_time ? log.created_time.replace('T', ' ').slice(0, 19) : '-'}
                    </Td>
                    <Td className="font-mono text-sm font-medium">{log.ip}</Td>
                    <Td className="max-w-xs text-xs text-muted-foreground">
                      <span className="block truncate" title={log.user_agent}>
                        {log.user_agent || '浏览器客户端'}
                      </span>
                    </Td>
                    <Td>
                      <Tag tone="success">登录成功</Tag>
                    </Td>
                  </tr>
                ))}
              </Table>
            )}
      </Card>
    </>
  );
}
