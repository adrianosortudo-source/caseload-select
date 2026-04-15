import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        navy: "#1E2F58",
        gold: "#C4B49A",
        "gold-2": "#b09e86",
        parchment: "#F4F3EF",
      },
    },
  },
  plugins: [],
};

export default config;
