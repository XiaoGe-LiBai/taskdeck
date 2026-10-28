import { cn } from '@/utils/Helpers';

function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        `
          h-10 w-full min-w-0 rounded-md border border-input bg-transparent px-3
          py-2 text-base shadow-xs transition-[color,box-shadow] outline-none
          placeholder:text-muted-foreground
          focus-visible:border-ring focus-visible:ring-[3px]
          focus-visible:ring-ring/50
          disabled:pointer-events-none disabled:cursor-not-allowed
          disabled:opacity-50
          md:text-sm
        `,
        className,
      )}
      {...props}
    />
  );
}

function Select({ className, ...props }: React.ComponentProps<'select'>) {
  return (
    <select
      data-slot="select"
      className={cn(
        `
          h-10 w-full rounded-md border border-input bg-transparent px-3 py-2
          text-sm shadow-xs outline-none
          focus-visible:border-ring focus-visible:ring-[3px]
          focus-visible:ring-ring/50
        `,
        className,
      )}
      {...props}
    />
  );
}

export { Input, Select };
