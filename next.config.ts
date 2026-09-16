import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  headers: async () => [
    {
      source: '/(.*)',
      headers: [
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        {
          key: 'Content-Security-Policy',
          value: [
            "default-src 'self'",
            process.env.NEXT_PUBLIC_CSP_DEV
              ? "script-src 'self' 'unsafe-eval' 'unsafe-inline'"
              : "script-src 'self' 'unsafe-inline'",
            "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
            "font-src 'self' https://fonts.gstatic.com",
            "connect-src 'self' https://mempool.space https://*.mempool.space https://mempool.emzy.de https://memepool.space https://blockstream.info https://ordinals.com http://127.0.0.1:8080",
            "worker-src 'self' blob:",
            "img-src 'self' data: blob:",
            "frame-ancestors 'none'",
          ].join('; '),
        },
      ],
    },
  ],
  turbopack: {
    root: __dirname,
  },
  webpack: (config) => {
    config.experiments = { ...config.experiments, asyncWebAssembly: true };
    config.resolve.fallback = { ...config.resolve.fallback, fs: false, net: false, tls: false, crypto: false };
    return config;
  },
};

export default nextConfig;
