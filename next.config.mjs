/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Keep native/Node-only packages out of the webpack bundle.
    // parquetjs lazy-loads optional codecs like `lzo`, which can fail
    // resolution during deploy-time builds even when runtime import is fine.
    serverComponentsExternalPackages: ["better-sqlite3", "parquetjs", "@dsnp/parquetjs"],
  },
};

export default nextConfig;
