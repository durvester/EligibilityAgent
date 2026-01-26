/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: '#A8D5E5', // Light blue
          50: '#F0F9FC',
          100: '#E1F3F9',
          200: '#C3E7F3',
          300: '#A8D5E5',
          400: '#7BC4D9',
          500: '#4EB3CD',
          600: '#2A9AB8',
          700: '#1F7A93',
          800: '#165A6D',
          900: '#0D3A48',
        },
        success: '#10B981',
        error: '#EF4444',
        neutral: {
          50: '#F9FAFB',
          100: '#F3F4F6',
          200: '#E5E7EB',
          300: '#D1D5DB',
          400: '#9CA3AF',
          500: '#6B7280',
          600: '#4B5563',
          700: '#374151',
          800: '#1F2937',
          900: '#111827',
        },
      },
      fontFamily: {
        sans: ['Inter', 'SF Pro Display', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
