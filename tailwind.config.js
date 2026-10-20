/** @type {import('tailwindcss').Config} */
module.exports = {
  corePlugins: {
    preflight: false,
  },
  content: ['./src/**/*.{html,ts,scss}'],
  theme: {
    extend: {
      colors: {
        brand: {
          orange: '#FF7F00',
          'orange-dark': '#E86F00',
          cream: '#FFFBF5',
        },
      },
      fontFamily: {
        sans: ['Nunito', 'Cairo', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
