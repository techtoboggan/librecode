import { ComponentProps } from "solid-js"

export const Mark = (props: { class?: string }) => {
  return (
    <svg
      data-component="logo-mark"
      classList={{ [props.class ?? ""]: !!props.class }}
      viewBox="0 0 40 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* LC monogram placeholder */}
      <rect width="40" height="40" rx="8" fill="var(--icon-weak-base)" />
      <text x="20" y="28" text-anchor="middle" font-size="22" font-weight="bold" font-family="monospace" fill="var(--icon-strong-base)">LC</text>
    </svg>
  )
}

export const Splash = (props: Pick<ComponentProps<"svg">, "ref" | "class">) => {
  return (
    <svg
      ref={props.ref}
      data-component="logo-splash"
      classList={{ [props.class ?? ""]: !!props.class }}
      viewBox="0 0 80 80"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* LC monogram splash placeholder */}
      <rect width="80" height="80" rx="16" fill="var(--icon-base)" opacity="0.1" />
      <text x="40" y="52" text-anchor="middle" font-size="40" font-weight="bold" font-family="monospace" fill="var(--icon-strong-base)">LC</text>
    </svg>
  )
}

export const Logo = (props: { class?: string }) => {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 280 42"
      fill="none"
      classList={{ [props.class ?? ""]: !!props.class }}
    >
      {/* LibreCode wordmark placeholder — replace with final brand SVG */}
      <text x="0" y="32" font-size="36" font-weight="700" font-family="Inter, -apple-system, sans-serif" fill="var(--icon-base)">
        <tspan fill="var(--icon-base)">Libre</tspan>
        <tspan fill="var(--icon-strong-base)">Code</tspan>
      </text>
    </svg>
  )
}
