'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [
  { href: '/', label: 'Sorting', live: true },
  { href: '/compose', label: 'Compose', live: true },
  { href: '/consolidate', label: 'Consolidation', live: false },
] as const;

export default function AppFooter() {
  const pathname = usePathname();

  return (
    <footer className="fixed bottom-0 inset-x-0 z-50 border-t border-gray-800 bg-gray-950/95 backdrop-blur">
      <nav className="mx-auto flex max-w-3xl items-stretch justify-around px-2 pb-[env(safe-area-inset-bottom)]">
        {TABS.map((tab) => {
          const active = tab.live && (
            tab.href === '/'
              ? pathname === '/'
              : pathname === tab.href || pathname.startsWith(`${tab.href}/`)
          );

          if (!tab.live) {
            return (
              <span
                key={tab.href}
                aria-disabled="true"
                title="Not live yet"
                className="flex flex-1 flex-col items-center justify-center gap-0.5 py-3 text-xs text-gray-600 cursor-not-allowed select-none"
              >
                <span>{tab.label}</span>
                <span className="text-[10px] uppercase tracking-wide text-gray-700">Not Live</span>
              </span>
            );
          }

          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`flex flex-1 flex-col items-center justify-center gap-0.5 py-3 text-xs transition-colors ${
                active
                  ? 'text-orange-400 font-medium'
                  : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              <span>{tab.label}</span>
              <span className={`h-0.5 w-8 rounded-full ${active ? 'bg-orange-500' : 'bg-transparent'}`} />
            </Link>
          );
        })}
      </nav>
    </footer>
  );
}
