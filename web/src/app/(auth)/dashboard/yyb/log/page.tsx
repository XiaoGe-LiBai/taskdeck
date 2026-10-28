import { Card, Empty, PageTitle } from '@/features/panel/Ui';
import { panelSend } from '@/libs/PanelApi';

export default async function YybLogPage(props: {
  searchParams: Promise<{ ref?: string; log_key?: string; script_key?: string }>;
}) {
  const query = await props.searchParams;

  const ref = query.ref ?? '';
  const logKey = query.log_key ?? '';

  const result = ref && logKey
    ? await panelSend<{ content?: string; log?: string; output?: string }>('POST', '/yyb/runs/log', {
        ref,
        log_key: logKey,
        script_key: query.script_key ?? '',
      })
    : null;

  const content = result?.data?.content ?? result?.data?.log ?? result?.data?.output ?? '';

  return (
    <>
      <PageTitle
        title="运行日志"
        description={`账号 #${ref} · ${logKey || '未指定日志'}`}
      />

      <Card
        title="日志全文"
        description={result && !result.ok ? result.msg : '来自 YYB 的日志读取接口'}
      >
        {content
          ? (
              <pre className="
                max-h-[70vh] overflow-auto rounded-md bg-muted p-4 text-xs
                whitespace-pre-wrap
              "
              >
                {content}
              </pre>
            )
          : <Empty text="没有读到日志内容（可能已过期或被清理）" />}
      </Card>

      <div className="mt-4">
        <a
          href={`/dashboard/yyb/jobs?ref=${ref}`}
          className="
            rounded-md border px-3 py-1.5 text-sm transition-all duration-150
            hover:bg-muted active:scale-95
          "
        >
          ‹ 返回运行管理
        </a>
      </div>
    </>
  );
}

export const dynamic = 'force-dynamic';
