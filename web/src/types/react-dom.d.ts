declare module 'react-dom' {
  export function useFormStatus(): {
    pending: boolean;
    data: FormData | null;
    method: string | null;
    action: ((formData: FormData) => void | Promise<void>) | null;
  };
}
