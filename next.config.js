/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Allow the in-process poller singleton to survive across hot reloads in dev.
  experimental: { serverComponentsExternalPackages: ['@prisma/client'] },
};

module.exports = nextConfig;
