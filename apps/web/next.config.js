/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@eligibility-agent/shared'],
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
