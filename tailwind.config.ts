import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        yahoo: {
          orange: '#FF6600',
          'orange-dark': '#CC5200',
          'orange-light': '#FF8533',
        },
      },
    },
  },
  plugins: [],
}
export default config
