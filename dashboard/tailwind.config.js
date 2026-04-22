/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        'airbnb-red': '#FF385C',
        'airbnb-teal': '#00A699',
        'surface': '#111218',
        'surface-2': '#1A1D27',
        'border': '#1E2030',
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', 'Inter', 'Segoe UI', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
