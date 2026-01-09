import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,

  // Enable static export for Tauri
  output: process.env.BUILD_TARGET === 'tauri' ? 'export' : undefined,

  // Image optimization settings
  images: {
    unoptimized: true, // Required for static export
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**.supabase.co',
      },
    ],
  },

  // Disable server-side features when building for Tauri
  ...(process.env.BUILD_TARGET === 'tauri' && {
    distDir: 'out',
  }),
};

export default nextConfig;
