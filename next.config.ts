import type { NextConfig } from "next";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Pin the workspace root to this project so the build never mis-infers a parent
// directory when a stray lockfile exists above it (deterministic Vercel builds).
const projectRoot = dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  // Read at run time on the server (certificate templates); never bundled.
  serverExternalPackages: ["pdfjs-dist"],
  turbopack: { root: projectRoot },
  outputFileTracingRoot: projectRoot,
};

export default nextConfig;
