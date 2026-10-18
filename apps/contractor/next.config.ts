import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Workspace packages ship TypeScript source; Next compiles them with the app.
  transpilePackages: ["@homefax/core", "@homefax/ui", "@homefax/db", "@homefax/auth"],
};

export default nextConfig;
