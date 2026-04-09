import { ComponentProps } from "solid-js"

/**
 * Brand colors from assets/brand/tokens.css:
 * - Teal 500: #0D9488 (primary brand)
 * - Blue 500: #1E6CA0 (secondary)
 * - Navy: #15476C (deep accent)
 *
 * Using CSS variables where available, falling back to brand hex values.
 * Replace these SVG text elements with final vector paths from DESIGN-SPEC.md
 * when the actual logo is generated.
 */

export const Mark = (props: { class?: string }) => {
  return (
    <svg
      data-component="logo-mark"
      classList={{ [props.class ?? ""]: !!props.class }}
      viewBox="0 0 128 128"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id="lc-mark-grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#2DD4A8" />
          <stop offset="50%" stop-color="#0D9488" />
          <stop offset="100%" stop-color="#1E6CA0" />
        </linearGradient>
      </defs>
      <rect width="128" height="128" rx="28" fill="var(--color-background-base, #0A0B0D)" />
      <text
        x="64"
        y="86"
        text-anchor="middle"
        font-size="64"
        font-weight="800"
        font-family="Inter, -apple-system, system-ui, sans-serif"
        fill="url(#lc-mark-grad)"
        letter-spacing="-2"
      >
        LC
      </text>
    </svg>
  )
}

export const Splash = (props: Pick<ComponentProps<"svg">, "ref" | "class">) => {
  return (
    <svg
      ref={props.ref}
      data-component="logo-splash"
      classList={{ [props.class ?? ""]: !!props.class }}
      viewBox="0 0 120 120"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id="lc-splash-grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#2DD4A8" />
          <stop offset="50%" stop-color="#0D9488" />
          <stop offset="100%" stop-color="#1E6CA0" />
        </linearGradient>
      </defs>
      <text
        x="60"
        y="82"
        text-anchor="middle"
        font-size="72"
        font-weight="800"
        font-family="Inter, -apple-system, system-ui, sans-serif"
        fill="url(#lc-splash-grad)"
        letter-spacing="-3"
        opacity="0.15"
      >
        LC
      </text>
    </svg>
  )
}

export const Logo = (props: { class?: string }) => {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 340 48"
      fill="none"
      classList={{ [props.class ?? ""]: !!props.class }}
    >
      <defs>
        <linearGradient id="lc-logo-grad" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stop-color="#0D9488" />
          <stop offset="100%" stop-color="#1E6CA0" />
        </linearGradient>
      </defs>
      {/* LIBRE in navy, CODE in teal gradient — matches brand spec */}
      <text
        y="38"
        font-size="42"
        font-weight="800"
        font-family="Inter, -apple-system, system-ui, sans-serif"
        letter-spacing="3"
      >
        <tspan fill="#15476C">LIBRE</tspan>
        <tspan fill="url(#lc-logo-grad)">CODE</tspan>
      </text>
    </svg>
  )
}
