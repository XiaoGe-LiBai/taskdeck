import { Aurora, FloatingLines } from '@/components/reactbits';

export const CenteredContainer = (props: {
  children: React.ReactNode;
}) => (
  <div className="
    relative flex min-h-svh flex-col items-center justify-center gap-6
    overflow-hidden p-6
    md:p-10
  "
  >
    <Aurora />
    <FloatingLines lines={4} />
    <div className="relative z-10 flex w-full flex-col items-center gap-6">
      {props.children}
    </div>
  </div>
);
