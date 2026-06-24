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
        // Primary palette
        navy: "#1E2F58",
        gold: "#C4B49A",
        "gold-on-light": "#8B7A5E",
        parchment: "#F4F3EF",
        "deep-black": "#0D1520",
        // Text scale
        body: "#4A5A72",
        muted: "#8090A8",
        "field-label": "#5E6D82",
        // Surface & border
        "border-brand": "#E0DDD6",
        "off-white": "#F9F8F5",
        "parchment-2": "#ECEAE4",
        "row-alt": "#ECEAE4",
        highlight: "#FFF8F0",
        // Semantic status
        "green-pass": "#27834A",
        "red-fail": "#C0564E",
      },
      fontFamily: {
        display: ["var(--font-oxanium)", "sans-serif"],
        primary: ["var(--font-manrope)", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
