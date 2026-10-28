/* eslint-disable next/no-img-element -- 二维码是服务端转好的 data URL，不需要 next/image 优化 */
'use client';

import type { YybProxyArea, YybProxyPayload, YybProxyProfile } from './yybActions';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import {
  yybProxyCitiesAction,
  yybProxyProvincesAction,
  yybProxyTestAction,
  yybQrPollAction,
  yybQrStartAction,
} from './yybActions';

const STATUS_LABEL: Record<string, string> = {
  pending: '等待扫码…',
  scanned: '已扫码，请在手机上点击确认',
  confirmed: '已确认，正在写入账号…',
  success: '登录成功，账号已写入',
  done: '登录成功，账号已写入',
  expired: '二维码已过期，请重新生成',
  error: '扫码失败，请重试',
  failed: '扫码失败，请重试',
};

/** 这些状态说明还在等用户操作，继续轮询 */
const PENDING_STATES = new Set(['', 'pending', 'scanned', 'confirmed']);
const FAILED_STATES = new Set(['expired', 'error', 'failed']);

type ProxyMode = 'direct' | 'static' | 'api' | 'profile';

const PROXY_STORAGE_KEY = 'yyb.scan.proxy';

const labelClass = 'flex flex-col gap-1 text-xs font-medium text-muted-foreground';
const inputClass = `
  h-9 w-full rounded-md border border-input bg-background px-2.5 text-sm
  text-foreground
`;
const selectClass = `
  h-9 w-full rounded-md border border-input bg-background px-2 text-sm
  text-foreground
`;
const ghostButtonClass = `
  rounded-md border border-input bg-background px-3 py-1.5 text-xs font-medium
  transition-colors
  hover:bg-muted
  disabled:opacity-60
`;

const proxyModeForPayload = (mode: ProxyMode): 'direct' | 'static' | 'api' =>
  mode === 'profile' ? 'api' : mode;

/**
 * YYB 扫码加号：二维码由 YYB 服务实时生成，面板负责展示与轮询。
 * 二维码图片经服务端代理取回（Flask 侧需要 Bearer，浏览器拿不到）。
 *
 * 「登录网络代理」四种模式与 YYB /scan 对齐（direct/static/api/profile），
 * 配置库与省市列表直接读 YYB，选中的配置随 POST /qr 下发。
 */
export const YybScanPanel = (props: {
  endpointId?: number;
  isAdmin?: boolean;
  consoleUrl?: string;
  initialProfiles?: YybProxyProfile[];
}) => {
  const router = useRouter();
  const [image, setImage] = useState('');
  const [sessionId, setSessionId] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [succeeded, setSucceeded] = useState(false);
  const stoppedRef = useRef(true);

  // —— 登录网络代理
  const [proxyMode, setProxyMode] = useState<ProxyMode>('direct');
  const [proxyType, setProxyType] = useState<'http' | 'socks5'>('http');
  const [staticProxy, setStaticProxy] = useState('');
  const [apiUrl, setApiUrl] = useState('');
  const [profileId, setProfileId] = useState('');
  const [provinceCode, setProvinceCode] = useState('all');
  const [cityCode, setCityCode] = useState('');
  const profiles = props.initialProfiles ?? [];
  // 普通用户在没有可用配置时不显示「供应商配置」，避免看到一个空模式
  const showProfileMode = profiles.length > 0 || Boolean(props.isAdmin);
  const [provinces, setProvinces] = useState<YybProxyArea[]>([]);
  const [cities, setCities] = useState<YybProxyArea[]>([]);
  const [proxyMessage, setProxyMessage] = useState('默认直连');
  const [testing, setTesting] = useState(false);
  const [proxyLoaded, setProxyLoaded] = useState(false);
  const [restored, setRestored] = useState(false);
  const [proxyOpen, setProxyOpen] = useState(false);

  // 恢复上次选择，避免每次扫码都重新填。
  // localStorage 只能在浏览器读：用 useState 初始化会造成服务端/客户端首屏不一致，
  // 所以必须放在 effect 里。
  /* eslint-disable react/set-state-in-effect */
  useEffect(() => {
    try {
      const raw = localStorage.getItem(PROXY_STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as Record<string, unknown>;
        if (typeof saved.mode === 'string' && ['direct', 'static', 'api', 'profile'].includes(saved.mode)) {
          const savedMode = saved.mode as ProxyMode;
          // 没有可用配置时，不恢复到一个不存在的模式
          const restoredMode = savedMode === 'profile' && !showProfileMode ? 'direct' : savedMode;
          setProxyMode(restoredMode);
          if (restoredMode !== 'direct') {
            setProxyOpen(true);
          }
        }
        if (saved.proxyType === 'http' || saved.proxyType === 'socks5') {
          setProxyType(saved.proxyType);
        }
        if (typeof saved.staticProxy === 'string') {
          setStaticProxy(saved.staticProxy);
        }
        if (typeof saved.apiUrl === 'string') {
          setApiUrl(saved.apiUrl);
        }
        if (typeof saved.profileId === 'string') {
          setProfileId(saved.profileId);
        }
        if (typeof saved.provinceCode === 'string') {
          setProvinceCode(saved.provinceCode);
        }
      }
    } catch {
      // localStorage 不可用时忽略
    }
    setRestored(true);
  }, []);
  /* eslint-enable react/set-state-in-effect */

  // 记住选择
  useEffect(() => {
    if (!restored) {
      return;
    }
    try {
      localStorage.setItem(PROXY_STORAGE_KEY, JSON.stringify({
        mode: proxyMode,
        proxyType,
        staticProxy,
        apiUrl,
        profileId,
        provinceCode,
      }));
    } catch {
      // 忽略
    }
  }, [restored, proxyMode, proxyType, staticProxy, apiUrl, profileId, provinceCode]);

  // 省份：第一次切到 profile 时懒加载（配置库由服务端随页面带入）
  useEffect(() => {
    if (proxyMode !== 'profile' || proxyLoaded) {
      return;
    }
    let active = true;
    (async () => {
      const res = await yybProxyProvincesAction(props.endpointId);
      if (!active) {
        return;
      }
      if (res.ok) {
        setProvinces(res.data);
      }
      setProxyLoaded(true);
      if (!res.ok) {
        setProxyMessage(`省份列表读取失败：${res.error}`);
      }
    })();
    return () => {
      active = false;
    };
  }, [proxyMode, proxyLoaded, props.endpointId]);

  // 省份切换：清空已选城市，并按需拉取城市列表
  const changeProvince = useCallback(async (value: string) => {
    setProvinceCode(value);
    setCityCode('');
    setCities([]);
    if (proxyMode !== 'profile' || !value || value === 'all') {
      return;
    }
    const res = await yybProxyCitiesAction(value, props.endpointId);
    setCities(res.ok ? res.data : []);
    if (!res.ok) {
      setProxyMessage(`城市列表读取失败：${res.error}`);
    }
  }, [proxyMode, props.endpointId]);

  const buildProxyPayload = useCallback((): YybProxyPayload => {
    const useProfile = proxyMode === 'profile';
    const provinceName = provinces.find(p => p.code === provinceCode)?.name ?? '';
    const cityName = cities.find(c => c.code === cityCode)?.name ?? '';
    return {
      product: 'appstore',
      mode: proxyModeForPayload(proxyMode),
      proxy_type: proxyType,
      static_proxy: staticProxy.trim(),
      api_url: apiUrl.trim(),
      provider_profile_id: useProfile && profileId ? Number(profileId) : null,
      region_code: useProfile ? (cityCode || provinceCode || '') : '',
      region_province: useProfile ? provinceName : '',
      region_city: useProfile ? cityName : '',
      refresh_ahead_minutes: 5,
    };
  }, [proxyMode, proxyType, staticProxy, apiUrl, profileId, provinceCode, cityCode, provinces, cities]);

  const proxyLabel = useMemo(() => {
    if (proxyMode === 'direct') {
      return '直连';
    }
    if (proxyMode === 'static') {
      return '静态代理';
    }
    if (proxyMode === 'api') {
      return '自定义动态 API';
    }
    const profile = profiles.find(p => String(p.id) === profileId)?.name ?? '供应商配置（未选择）';
    const province = provinces.find(p => p.code === provinceCode)?.name ?? '全国';
    const city = cities.find(c => c.code === cityCode)?.name ?? '';
    return `${profile} · ${city || province}`;
  }, [proxyMode, profiles, profileId, provinces, provinceCode, cities, cityCode]);

  const start = useCallback(async () => {
    setLoading(true);
    setError('');
    setImage('');
    setStatus('');
    setSucceeded(false);
    stoppedRef.current = false;

    const res = await yybQrStartAction(props.endpointId, buildProxyPayload());
    setLoading(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setImage(res.image);
    setSessionId(res.sessionId);
    setStatus(res.status || 'pending');
    setProxyMessage(`本次授权使用：${proxyLabel}`);
  }, [props.endpointId, buildProxyPayload, proxyLabel]);

  const testProxy = useCallback(async () => {
    setTesting(true);
    setProxyMessage('正在提取并校验代理…');
    const res = await yybProxyTestAction(buildProxyPayload(), props.endpointId);
    setTesting(false);
    if (!res.ok) {
      setProxyMessage(`代理测试失败：${res.error}`);
      return;
    }
    if (!res.data.resolved) {
      setProxyMessage('直连模式无需代理');
      return;
    }
    const exit = [res.data.exit_region, res.data.exit_city].filter(Boolean).join(' · ');
    setProxyMessage(
      exit
        ? `代理可用：${res.data.proxy ?? ''}；出口 ${exit}`
        : `代理可用：${res.data.proxy ?? ''}${res.data.probe_error ? `；${res.data.probe_error}` : ''}`,
    );
  }, [buildProxyPayload, props.endpointId]);

  useEffect(() => {
    if (!sessionId || stoppedRef.current) {
      return;
    }
    let cancelled = false;
    const timer = setInterval(async () => {
      if (cancelled || stoppedRef.current) {
        return;
      }
      const res = await yybQrPollAction(sessionId, props.endpointId);
      if (cancelled) {
        return;
      }
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setStatus(res.status);
      if (!PENDING_STATES.has(res.status)) {
        stoppedRef.current = true;
        clearInterval(timer);
        if (FAILED_STATES.has(res.status)) {
          setError(STATUS_LABEL[res.status] ?? '扫码失败');
        } else {
          setSucceeded(true);
          router.refresh();
        }
      }
    }, 2500);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [sessionId, props.endpointId, router]);

  const statusText = succeeded
    ? '登录成功，账号已写入'
    : (error || STATUS_LABEL[status] || (status ? `状态：${status}` : '尚未开始'));

  return (
    <div className="flex flex-col gap-5">
      <details
        className="rounded-md border bg-muted/20 p-3"
        open={proxyOpen}
        onToggle={event => setProxyOpen(event.currentTarget.open)}
      >
        <summary className="cursor-pointer text-sm font-medium select-none">
          登录网络代理
          <span className="ml-2 text-xs font-normal text-muted-foreground">
            {`当前：${proxyLabel}`}
          </span>
        </summary>

        <div className="
          mt-3 grid gap-3
          sm:grid-cols-2
        "
        >
          <label className={labelClass}>
            连接模式
            <select
              className={selectClass}
              value={proxyMode}
              onChange={event => setProxyMode(event.target.value as ProxyMode)}
            >
              <option value="direct">直连</option>
              <option value="static">静态代理</option>
              <option value="api">动态代理 API</option>
              {showProfileMode && <option value="profile">供应商配置</option>}
            </select>
          </label>

          <label className={labelClass}>
            代理协议
            <select
              className={selectClass}
              value={proxyType}
              disabled={proxyMode === 'direct' || proxyMode === 'profile'}
              onChange={event => setProxyType(event.target.value as 'http' | 'socks5')}
            >
              <option value="http">HTTP CONNECT</option>
              <option value="socks5">SOCKS5</option>
            </select>
          </label>

          {proxyMode === 'static' && (
            <label className={`
              ${labelClass}
              sm:col-span-2
            `}
            >
              代理地址
              <Input
                className={inputClass}
                value={staticProxy}
                onChange={event => setStaticProxy(event.target.value)}
                placeholder="user:pass@127.0.0.1:8080"
                autoComplete="off"
                spellCheck={false}
              />
            </label>
          )}

          {proxyMode === 'api' && (
            <label className={`
              ${labelClass}
              sm:col-span-2
            `}
            >
              代理提取 API
              <Input
                className={inputClass}
                value={apiUrl}
                onChange={event => setApiUrl(event.target.value)}
                placeholder="https://example.com/get?province=山东&city=济南"
                autoComplete="off"
                spellCheck={false}
              />
              <span className="text-[11px] font-normal">
                支持 txt、json、json2；短效代理不能用于账号保活，只影响本次登录。
              </span>
            </label>
          )}

          {proxyMode === 'profile' && (
            <>
              <div className={`
                ${labelClass}
                sm:col-span-2
              `}
              >
                <label htmlFor="yyb-proxy-profile">供应商配置</label>
                <select
                  id="yyb-proxy-profile"
                  className={selectClass}
                  value={profileId}
                  onChange={event => setProfileId(event.target.value)}
                >
                  <option value="">请选择配置</option>
                  {profiles.map(profile => (
                    <option key={profile.id} value={String(profile.id)}>
                      {`${profile.name} · ${profile.provider === 'juliang' ? '巨量' : profile.provider === 'static' ? '静态预设' : '品赞'}`}
                    </option>
                  ))}
                </select>
                {profiles.length === 0 && props.isAdmin && (
                  <span className="text-[11px] font-normal">
                    还没有代理配置。
                    {props.consoleUrl
                      ? (
                          <>
                            {' '}
                            <a
                              className="underline underline-offset-2"
                              href={`${props.consoleUrl}/proxies`}
                              target="_blank"
                              rel="noreferrer"
                            >
                              去 YYB 控制台添加
                            </a>
                          </>
                        )
                      : null}
                  </span>
                )}
              </div>

              <label className={labelClass}>
                省份
                <select
                  className={selectClass}
                  value={provinceCode}
                  onChange={event => void changeProvince(event.target.value)}
                >
                  <option value="all">全国</option>
                  {provinces.filter(area => area.code !== 'all').map(area => (
                    <option key={area.code} value={area.code}>{area.name}</option>
                  ))}
                </select>
              </label>

              <label className={labelClass}>
                城市
                <select
                  className={selectClass}
                  value={cityCode}
                  onChange={event => setCityCode(event.target.value)}
                  disabled={provinceCode === 'all'}
                >
                  <option value="">全省</option>
                  {cities.map(area => (
                    <option key={area.code} value={area.code}>{area.name}</option>
                  ))}
                </select>
              </label>
            </>
          )}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="button" className={ghostButtonClass} onClick={testProxy} disabled={testing}>
            {testing ? '测试中…' : '测试代理'}
          </button>
          <button type="button" className={ghostButtonClass} onClick={start} disabled={loading}>
            应用并生成二维码
          </button>
          <span className="text-xs text-muted-foreground">{proxyMessage}</span>
        </div>

        <p className="mt-2 text-[11px] text-muted-foreground">
          修改后需重新生成二维码才会生效；已经生成的会话保持原配置。
        </p>
      </details>

      <div className="
        flex flex-col gap-5
        sm:flex-row
      "
      >
        <div className="flex shrink-0 flex-col items-center gap-2">
          <div className="
            flex size-44 items-center justify-center overflow-hidden rounded-md
            border bg-white p-1
          "
          >
            {image
              ? (
                  <img
                    src={image}
                    alt="微信扫码加号"
                    className="size-full object-contain"
                  />
                )
              : <span className="px-3 text-center text-xs text-muted-foreground">未生成二维码</span>}
          </div>
          <button
            type="button"
            onClick={start}
            disabled={loading}
            className="
              rounded-md bg-brand-gradient px-4 py-2 text-sm text-white
              shadow-sm
              hover:opacity-90
              disabled:opacity-60
            "
          >
            {loading ? '生成中…' : image ? '重新生成二维码' : '开始扫码加号'}
          </button>
        </div>

        <div className="flex flex-1 flex-col gap-2 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">当前状态：</span>
            <span className={succeeded
              ? 'text-emerald-600'
              : `text-muted-foreground`}
            >
              {statusText}
            </span>
          </div>

          {error && !succeeded && (
            <div className="
              rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs
              text-red-700
              dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300
            "
            >
              ⚠️
              {' '}
              {error}
            </div>
          )}

          <ol className="
            mt-1 list-decimal space-y-1 pl-5 text-xs text-muted-foreground
          "
          >
            <li>点「开始扫码加号」，二维码由协议服务实时生成</li>
            <li>用要托管的微信扫码，并在手机上确认登录</li>
            <li>确认成功后本页会自动刷新，账号出现在上方列表</li>
            <li>二维码有效期约 2 分钟，过期请点「重新生成二维码」</li>
          </ol>
        </div>
      </div>
    </div>
  );
};
