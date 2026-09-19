import type { NextConfig } from "next";

const config: NextConfig = {
  transpilePackages: ["@pickler/ui", "@pickler/api-schema"],
};
export default config;
