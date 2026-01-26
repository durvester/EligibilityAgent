/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@eligibility-agent/shared'],
  // Enable standalone output for Docker deployments
  output: 'standalone',
  // NOTE: API proxying handled by Route Handlers in src/app/api/
  // Route Handlers properly forward cookies, unlike rewrites()
};

module.exports = nextConfig;
