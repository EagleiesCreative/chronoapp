import type { NextConfig } from "next";

const isTauriBuild = process.env.BUILD_TARGET === 'tauri';

const nextConfig: NextConfig = {
  reactCompiler: true,

  // Enable static export for Tauri
  output: isTauriBuild ? 'export' : undefined,

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
  ...(isTauriBuild && {
    // Skip type checking for faster builds (already done in dev)
    typescript: {
      ignoreBuildErrors: false,
    },
    eslint: {
      ignoreDuringBuilds: true,
    },
  }),

  // Note: API routes are automatically excluded via tauri:build script
  // since they are not supported in static export mode
};

export default nextConfig;
