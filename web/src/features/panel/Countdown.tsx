'use client';

import { useEffect, useState } from 'react';

/** 凭据剩余时间倒计时（本地每秒递减，不额外打接口） */
export const Countdown = (props: { seconds?: number; label?: string }) => {
  const [left, setLeft] = useState(props.seconds ?? 0);

  useEffect(() => {
    setLeft(props.seconds ?? 0);
  }, [props.seconds]);

  useEffect(() => {
    const timer = setInterval(() => setLeft(value => (value > 0 ? value - 1 : 0)), 1000);
    return () => clearInterval(timer);
  }, []);

  const hours = Math.floor(left / 3600);
  const minutes = Math.floor((left % 3600) / 60);
  const seconds = left % 60;

  return (
    <span className="tabular-nums">
      {props.label}
      {left > 0 ? `${hours}h ${minutes}m ${seconds}s` : '已过期'}
    </span>
  );
};
