import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Stackr ships the frontend as a static export embedded in the C++ binary.
  output: "export",
  trailingSlash: false,
  images: { unoptimized: true },
  reactStrictMode: true,
  // Static export does not run server middleware; rewrites/headers are no-ops at runtime.
  experimental: {},
};

export default nextConfig;
