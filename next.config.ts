import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Prisma driver adapter + pg run in the Node.js runtime, keep them out of the bundle.
  serverExternalPackages: ["@prisma/adapter-pg", "pg", "bullmq", "ioredis"],
  typedRoutes: false,
  devIndicators: false,
};

export default nextConfig;
