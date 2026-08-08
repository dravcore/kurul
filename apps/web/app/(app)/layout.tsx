import { AppShell } from '@/components/app-shell';

export default function AppLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>): React.ReactElement {
  return <AppShell>{children}</AppShell>;
}
