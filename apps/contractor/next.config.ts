import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Workspace packages ship TypeScript source; Next compiles them with the app.
  transpilePackages: ["@homefax/core", "@homefax/ui", "@homefax/db", "@homefax/auth", "@homefax/app-kit"],
};

export default nextConfig;
