import type { Config } from "tailwindcss";
import typography from "@tailwindcss/typography";
import animate from "tailwindcss-animate";

export default {
  darkMode: ["class"],
  content: ["./client/index.html", "./client/src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      // Radii scale (tokens: --radius = 8px). sm 4 · md 6 · lg 8 · xl 12 · 2xl 16.
      borderRadius: {
        sm: "calc(var(--radius) - 4px)",
        md: "calc(var(--radius) - 2px)",
        lg: "var(--radius)",
        xl: "calc(var(--radius) + 4px)",
        "2xl": "calc(var(--radius) + 8px)",
      },
      // Type scale (WP-A, spec 2.1). These named steps are the only sizes screens need.
      // display-xl / display / kpi are responsive through CSS variables (index.css).
      fontSize: {
        "display-xl": [
          "var(--text-display-xl-size)",
          {
            lineHeight: "var(--text-display-xl-line)",
            letterSpacing: "-0.032em",
            fontWeight: "var(--fw-heading)",
          },
        ],
        display: [
          "var(--text-display-size)",
          {
            lineHeight: "var(--text-display-line)",
            letterSpacing: "-0.028em",
            fontWeight: "var(--fw-heading)",
          },
        ],
        lead: ["1.125rem", { lineHeight: "1.75rem" }],
        // The fixed steps read CSS variables too, so the app surface can set a roomier scale
        // and a calmer weight (index.css, html[data-surface="app"]).
        h1: [
          "var(--text-h1-size)",
          {
            lineHeight: "var(--text-h1-line)",
            letterSpacing: "-0.02em",
            fontWeight: "var(--fw-heading)",
          },
        ],
        h2: [
          "var(--text-h2-size)",
          {
            lineHeight: "var(--text-h2-line)",
            letterSpacing: "-0.012em",
            fontWeight: "var(--fw-heading)",
          },
        ],
        h3: [
          "var(--text-h3-size)",
          {
            lineHeight: "var(--text-h3-line)",
            letterSpacing: "-0.006em",
            fontWeight: "var(--fw-heading)",
          },
        ],
        h4: [
          "var(--text-h4-size)",
          { lineHeight: "var(--text-h4-line)", fontWeight: "var(--fw-heading)" },
        ],
        kpi: [
          "var(--text-kpi-size)",
          {
            lineHeight: "var(--text-kpi-line)",
            letterSpacing: "-0.02em",
            fontWeight: "var(--fw-heading)",
          },
        ],
        body: ["var(--text-body-size)", { lineHeight: "var(--text-body-line)" }],
        small: ["var(--text-small-size)", { lineHeight: "var(--text-small-line)" }],
        caption: [
          "var(--text-caption-size)",
          { lineHeight: "var(--text-caption-line)", letterSpacing: "0.01em", fontWeight: "500" },
        ],
      },
      // Weights as variables: the app surface maps semibold to 500 and bold to 600.
      fontWeight: {
        semibold: "var(--fw-semibold)",
        bold: "var(--fw-bold)",
      },
      // Semantic spacing (index.css "Spacing scale"): `p-card`, `gap-stack`, `space-y-section`,
      // `px-gutter`, `h-control`.
      spacing: {
        card: "var(--card-pad)",
        stack: "var(--stack-gap)",
        section: "var(--section-gap)",
        gutter: "var(--page-gutter)",
        control: "var(--control-h)",
        "control-sm": "var(--control-h-sm)",
        "control-lg": "var(--control-h-lg)",
        header: "var(--header-height)",
      },
      maxWidth: {
        content: "var(--content-max)",
        narrow: "var(--content-narrow)",
        reading: "var(--content-reading)",
        marketing: "var(--content-marketing)",
      },
      transitionDuration: {
        fast: "var(--duration-fast)",
        base: "var(--duration-base)",
        slow: "var(--duration-slow)",
      },
      transitionTimingFunction: {
        standard: "var(--ease-standard)",
        out: "var(--ease-out)",
      },
      colors: {
        // Raw palette (layer 1). Prefer the role colours below in components.
        brand: Object.fromEntries(
          ["50", "100", "200", "300", "400", "500", "600", "700", "800", "900", "950"].map((k) => [
            k,
            `hsl(var(--brand-${k}) / <alpha-value>)`,
          ])
        ),
        // Role colours (layer 3)
        background: "hsl(var(--background) / <alpha-value>)",
        foreground: "hsl(var(--foreground) / <alpha-value>)",
        border: "hsl(var(--border) / <alpha-value>)",
        input: "hsl(var(--input) / <alpha-value>)",
        card: {
          DEFAULT: "hsl(var(--card) / <alpha-value>)",
          foreground: "hsl(var(--card-foreground) / <alpha-value>)",
          border: "hsl(var(--card-border) / <alpha-value>)",
        },
        popover: {
          DEFAULT: "hsl(var(--popover) / <alpha-value>)",
          foreground: "hsl(var(--popover-foreground) / <alpha-value>)",
          border: "hsl(var(--popover-border) / <alpha-value>)",
        },
        primary: {
          DEFAULT: "hsl(var(--primary) / <alpha-value>)",
          foreground: "hsl(var(--primary-foreground) / <alpha-value>)",
          border: "var(--primary-border)",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary) / <alpha-value>)",
          foreground: "hsl(var(--secondary-foreground) / <alpha-value>)",
          border: "var(--secondary-border)",
        },
        muted: {
          DEFAULT: "hsl(var(--muted) / <alpha-value>)",
          foreground: "hsl(var(--muted-foreground) / <alpha-value>)",
          border: "var(--muted-border)",
        },
        accent: {
          DEFAULT: "hsl(var(--accent) / <alpha-value>)",
          foreground: "hsl(var(--accent-foreground) / <alpha-value>)",
          border: "var(--accent-border)",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive) / <alpha-value>)",
          foreground: "hsl(var(--destructive-foreground) / <alpha-value>)",
          border: "var(--destructive-border)",
        },
        ring: "hsl(var(--ring) / <alpha-value>)",
        chart: {
          "1": "hsl(var(--chart-1) / <alpha-value>)",
          "2": "hsl(var(--chart-2) / <alpha-value>)",
          "3": "hsl(var(--chart-3) / <alpha-value>)",
          "4": "hsl(var(--chart-4) / <alpha-value>)",
          "5": "hsl(var(--chart-5) / <alpha-value>)",
          neutral: "hsl(var(--chart-neutral) / <alpha-value>)",
          grid: "hsl(var(--chart-grid) / <alpha-value>)",
          axis: "hsl(var(--chart-axis) / <alpha-value>)",
        },
        "surface-inverse": {
          DEFAULT: "hsl(var(--surface-inverse) / <alpha-value>)",
          foreground: "hsl(var(--surface-inverse-foreground) / <alpha-value>)",
          muted: "hsl(var(--surface-inverse-muted) / <alpha-value>)",
          border: "hsl(var(--surface-inverse-border) / <alpha-value>)",
        },
        sidebar: {
          ring: "hsl(var(--sidebar-ring) / <alpha-value>)",
          DEFAULT: "hsl(var(--sidebar) / <alpha-value>)",
          foreground: "hsl(var(--sidebar-foreground) / <alpha-value>)",
          border: "hsl(var(--sidebar-border) / <alpha-value>)",
          muted: "hsl(var(--sidebar-muted-foreground) / <alpha-value>)",
        },
        "sidebar-primary": {
          DEFAULT: "hsl(var(--sidebar-primary) / <alpha-value>)",
          foreground: "hsl(var(--sidebar-primary-foreground) / <alpha-value>)",
          border: "var(--sidebar-primary-border)",
        },
        "sidebar-accent": {
          DEFAULT: "hsl(var(--sidebar-accent) / <alpha-value>)",
          foreground: "hsl(var(--sidebar-accent-foreground) / <alpha-value>)",
          border: "var(--sidebar-accent-border)",
        },
        // Semantic status families — single source of truth for "paid green",
        // "overdue red", etc. Backed by the CSS variables in index.css so
        // light/dark both work without dark: overrides.
        success: {
          DEFAULT: "hsl(var(--success) / <alpha-value>)",
          foreground: "hsl(var(--success-foreground) / <alpha-value>)",
          subtle: "hsl(var(--success-subtle) / <alpha-value>)",
          "subtle-foreground": "hsl(var(--success-subtle-foreground) / <alpha-value>)",
        },
        warning: {
          DEFAULT: "hsl(var(--warning) / <alpha-value>)",
          foreground: "hsl(var(--warning-foreground) / <alpha-value>)",
          subtle: "hsl(var(--warning-subtle) / <alpha-value>)",
          "subtle-foreground": "hsl(var(--warning-subtle-foreground) / <alpha-value>)",
        },
        info: {
          DEFAULT: "hsl(var(--info) / <alpha-value>)",
          foreground: "hsl(var(--info-foreground) / <alpha-value>)",
          subtle: "hsl(var(--info-subtle) / <alpha-value>)",
          "subtle-foreground": "hsl(var(--info-subtle-foreground) / <alpha-value>)",
        },
        danger: {
          DEFAULT: "hsl(var(--danger) / <alpha-value>)",
          foreground: "hsl(var(--danger-foreground) / <alpha-value>)",
          subtle: "hsl(var(--danger-subtle) / <alpha-value>)",
          "subtle-foreground": "hsl(var(--danger-subtle-foreground) / <alpha-value>)",
        },
        positive: "hsl(var(--positive) / <alpha-value>)",
        negative: "hsl(var(--negative) / <alpha-value>)",
        "border-strong": "hsl(var(--border-strong) / <alpha-value>)",
        "surface-sunken": "hsl(var(--surface-sunken) / <alpha-value>)",
        neutral: {
          ...Object.fromEntries(
            [
              "0",
              "25",
              "50",
              "100",
              "200",
              "300",
              "400",
              "500",
              "600",
              "700",
              "800",
              "850",
              "900",
              "950",
            ].map((k) => [k, `hsl(var(--neutral-${k}) / <alpha-value>)`])
          ),
          subtle: "hsl(var(--neutral-subtle) / <alpha-value>)",
          "subtle-foreground": "hsl(var(--neutral-subtle-foreground) / <alpha-value>)",
        },
      },
      fontFamily: {
        sans: ["var(--font-sans)"],
        serif: ["var(--font-serif)"],
        // D2b (CTO 2): `font-mono` on money / document numbers renders in the UI sans with
        // tabular figures; real code (code, pre, kbd, samp) keeps --font-mono via index.css.
        mono: ["var(--font-figures)"],
        display: ["var(--font-display)"],
        arabic: ["var(--font-arabic)"],
      },
      boxShadow: {
        // Premium, dark-aware card elevation (defined in index.css). Every
        // <Card> uses `shadow-card-soft`; interactive cards lift to `-hover`.
        "card-soft": "var(--card-shadow)",
        "card-hover": "var(--card-shadow-hover)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        "fade-in": {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        "slide-up": {
          from: { transform: "translateY(6px)", opacity: "0" },
          to: { transform: "translateY(0)", opacity: "1" },
        },
        "slide-down": {
          from: { transform: "translateY(-6px)", opacity: "0" },
          to: { transform: "translateY(0)", opacity: "1" },
        },
        "slide-in-right": {
          from: { transform: "translateX(20px)", opacity: "0" },
          to: { transform: "translateX(0)", opacity: "1" },
        },
        // Spec 2.5: page content enters once per route change.
        "page-in": {
          from: { transform: "translateY(4px)", opacity: "0" },
          to: { transform: "none", opacity: "1" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "fade-in": "fade-in 180ms ease-out",
        "slide-up": "slide-up 200ms cubic-bezier(0.16, 1, 0.3, 1)",
        "slide-down": "slide-down 200ms cubic-bezier(0.16, 1, 0.3, 1)",
        "slide-in-right": "slide-in-right 200ms cubic-bezier(0.16, 1, 0.3, 1)",
        "page-in": "page-in 180ms cubic-bezier(0.16, 1, 0.3, 1)",
      },
    },
  },
  plugins: [animate, typography],
} satisfies Config;
