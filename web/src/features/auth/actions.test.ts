import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 注册相关 server action 单测（node 环境）：
 * - PanelApi / cookies / redirect 全部 mock，不真连后端、不真写 cookie
 * - redirect 在 Next 里靠抛错实现，测试里用哨兵错误接住来判断「要跳哪」
 */

const panelRegister = vi.hoisted(() => vi.fn());
const panelRegisterCode = vi.hoisted(() => vi.fn());
const cookieStore = vi.hoisted(() => ({ set: vi.fn(), delete: vi.fn() }));

vi.mock('@/libs/PanelApi', () => ({
  panelRegister,
  panelRegisterCode,
  panelLogin: vi.fn(),
  SESSION_COOKIE: 'xc_panel_token',
  USER_COOKIE: 'xc_panel_user',
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => cookieStore),
}));

class RedirectError extends Error {
  constructor(readonly url: string) {
    super(`NEXT_REDIRECT: ${url}`);
  }
}

vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw new RedirectError(url);
  }),
}));

const { sendRegisterCodeAction, signUpAction } = await import('./actions');

const formData = (entries: Record<string, string>) => {
  const fd = new FormData();
  Object.entries(entries).forEach(([key, value]) => fd.set(key, value));
  return fd;
};

const VALID = {
  email: 'new@test.local',
  password: 'test12345',
  confirmPassword: 'test12345',
  nickname: '测试用户',
  code: '123456',
};

const okRegister = {
  ok: true,
  data: { access_token: 'token-1', user: { id: 7, channel: 'xiaocan' } },
  msg: 'success',
  unauthorized: false,
};

describe('sendRegisterCodeAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('邮箱为空时直接拒绝，不调后端', async () => {
    const state = await sendRegisterCodeAction('');

    expect(state.ok).toBeUndefined();
    expect(state.error).toContain('邮箱');
    expect(panelRegisterCode).not.toHaveBeenCalled();
  });

  it('邮箱格式不对时拒绝', async () => {
    const state = await sendRegisterCodeAction('not-an-email');

    expect(state.error).toContain('邮箱');
    expect(panelRegisterCode).not.toHaveBeenCalled();
  });

  it('后端失败时透传 msg', async () => {
    panelRegisterCode.mockResolvedValue({ ok: false, data: null, msg: '发送太频繁了，请 60 秒后再试' });
    const state = await sendRegisterCodeAction('a@test.local');

    expect(panelRegisterCode).toHaveBeenCalledWith('a@test.local');
    expect(state.ok).toBeUndefined();
    expect(state.error).toBe('发送太频繁了，请 60 秒后再试');
  });

  it('成功时置 ok 并带倒计时 nonce；dev_code 有值就透传', async () => {
    panelRegisterCode.mockResolvedValue({ ok: true, data: { sent: true, dev_code: '654321' } });
    const state = await sendRegisterCodeAction(' a@Test.Local ');

    expect(state.ok).toBe(true);
    expect(state.devCode).toBe('654321');
    expect(state.nonce).toBeGreaterThan(0);
    // 发码前做了小写归一，避免同一邮箱大小写不同绕过节流
    expect(panelRegisterCode).toHaveBeenCalledWith('a@test.local');
  });

  it('已配置真实 SMTP 时 dev_code 为空，不回显', async () => {
    panelRegisterCode.mockResolvedValue({ ok: true, data: { sent: true, dev_code: null } });
    const state = await sendRegisterCodeAction('a@test.local');

    expect(state.ok).toBe(true);
    expect(state.devCode).toBeUndefined();
  });
});

describe('signUpAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cookieStore.set.mockClear();
  });

  it('缺邮箱或密码时拒绝', async () => {
    const state = await signUpAction({}, formData({ email: '', password: '', code: '123456' }));

    expect(state.error).toBe('请填写邮箱和密码');
    expect(panelRegister).not.toHaveBeenCalled();
  });

  it('密码不足 8 位拒绝', async () => {
    const state = await signUpAction({}, formData({ ...VALID, password: 'short', confirmPassword: 'short' }));

    expect(state.error).toBe('密码至少 8 位');
  });

  it('两次密码不一致拒绝', async () => {
    const state = await signUpAction({}, formData({ ...VALID, confirmPassword: 'different' }));

    expect(state.error).toBe('两次输入的密码不一致');
  });

  it('缺验证码拒绝（register_require_code=true 的前端闸门）', async () => {
    const state = await signUpAction({}, formData({ ...VALID, code: '' }));

    expect(state.error).toBe('请先获取并填写邮箱验证码');
    expect(panelRegister).not.toHaveBeenCalled();
  });

  it('后端拒绝时透传 msg（如验证码不正确 / 邮箱已注册）', async () => {
    panelRegister.mockResolvedValue({ ...okRegister, ok: false, data: null, msg: '验证码不正确' });
    const state = await signUpAction({}, formData(VALID));

    expect(state.error).toBe('验证码不正确');
    expect(cookieStore.set).not.toHaveBeenCalled();
  });

  it('成功时写入会话 cookie 并跳转 /dashboard，验证码一并提交', async () => {
    panelRegister.mockResolvedValue(okRegister);

    await expect(signUpAction({}, formData(VALID))).rejects.toThrow(RedirectError);

    expect(panelRegister).toHaveBeenCalledWith(expect.objectContaining({
      email: VALID.email,
      code: VALID.code,
      invite_code: '',
      confirmPassword: VALID.confirmPassword,
    }));
    expect(cookieStore.set).toHaveBeenCalledTimes(2);

    const [name, token] = cookieStore.set.mock.calls[0]!;

    expect(name).toBe('xc_panel_token');
    expect(token).toBe('token-1');
  });

  it('邀请码透传给后端', async () => {
    panelRegister.mockResolvedValue(okRegister);

    await expect(signUpAction({}, formData({ ...VALID, invite_code: 'ABC123' }))).rejects.toThrow(RedirectError);
    expect(panelRegister).toHaveBeenCalledWith(expect.objectContaining({ invite_code: 'ABC123' }));
  });
});
