import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#17202A",
        paper: "#F8FAFC",
        teal: "#0F766E",
        amber: "#B45309"
      }
    }
  },
  plugins: []
};

export default config;
