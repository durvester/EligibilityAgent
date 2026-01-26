/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@eligibility-agent/shared'],
  // Enable standalone output for Docker deployments
  output: 'standalone',
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${process.env.API_URL || 'http://localhost:3001'}/:path*`,
      },
    ];
  },
};

module.exports = nextConfig;
