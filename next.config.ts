import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native or Node-only packages that must not be bundled.
  serverExternalPackages: ["@napi-rs/keyring", "pg-boss", "playwright"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
