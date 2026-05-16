'use client';

type Variant = 'info' | 'success' | 'error' | 'warning';

const variantStyles: Record<Variant, string> = {
  info: 'border-blue-700 bg-blue-950/50 text-blue-300',
  success: 'border-green-700 bg-green-950/50 text-green-300',
  error: 'border-red-700 bg-red-950/50 text-red-300',
  warning: 'border-yellow-700 bg-yellow-950/50 text-yellow-300',
};

export default function StatusBanner({
  variant,
  message,
}: {
  variant: Variant;
  message: string;
}) {
  return (
    <div className={`w-full rounded-lg border px-4 py-3 text-sm ${variantStyles[variant]}`}>
      {message}
    </div>
  );
}
