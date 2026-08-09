import { DamgaMark } from '@/components/brand/damga-mark';

export default function AuthLayout({
  children,
}: Readonly<{ children: React.ReactNode }>): React.ReactElement {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-6 px-6 py-12">
      <DamgaMark size={64} />
      {children}
    </main>
  );
}
