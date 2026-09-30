import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  // Keep repo AGENTS.md authoritative; Next can still append its rules block.
};

export default nextConfig;
