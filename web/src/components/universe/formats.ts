// The card's copy formats. Doodles copy as code (as on svgdoodles.com); auctions copy the facts you need to check them.
import type { AuctionSummary } from "../../lib/types";

const INK = "#111111", SIZE = "64";

const pascal = (name: string) => name.replace(/[^a-zA-Z0-9]+(.)?/g, (_, c) => (c ? c.toUpperCase() : "")).replace(/^./, (c) => c.toUpperCase());
const sized = (svg: string, color = INK) =>
  svg.replace("<svg ", `<svg width="${SIZE}" height="${SIZE}" `).replaceAll("#fff", color);
const camel = (svg: string) =>
  svg.replace(/ ([a-z]+(?:-[a-z]+)+)=/g, (_, k: string) => " " + k.replace(/-(.)/g, (__, c) => c.toUpperCase()) + "=")
    .replace(/ clip-path=/g, " clipPath=").replace(/ xmlns="[^"]*"/, "");
const indent = (s: string, n: number) => s.split("\n").map((l) => " ".repeat(n) + l).join("\n");
const componentBody = (svg: string) =>
  camel(svg.replaceAll("#fff", "{color}").replace("<svg ", "<svg width={size} height={size} ")).replace(/"\{color\}"/g, "{color}");

export const DOODLE_FORMATS = [
  { value: "svg", label: "SVG" }, { value: "tsx", label: "TSX" }, { value: "jsx", label: "JSX" }, { value: "vue", label: "Vue" },
  { value: "svelte", label: "Svelte" }, { value: "astro", label: "Astro" }, { value: "react-native", label: "React Native" },
  { value: "base64", label: "Base64" }, { value: "css", label: "CSS" },
];

export function doodleAs(format: string, name: string, svg: string): string {
  const C = pascal(name);
  switch (format) {
    case "svg": return sized(svg);
    case "tsx": return [`type Props = { size?: number; color?: string };`, ``, `export const ${C} = ({ size = 64, color = "currentColor" }: Props) => (`, indent(componentBody(svg), 2), `);`, ``, `export default ${C};`].join("\n");
    case "jsx": return [`export const ${C} = ({ size = 64, color = "currentColor" }) => (`, indent(componentBody(svg), 2), `);`, ``, `export default ${C};`].join("\n");
    case "vue": return [`<script setup>`, `defineProps({ size: { type: Number, default: 64 }, color: { type: String, default: "currentColor" } });`, `</script>`, ``, `<template>`, indent(svg.replace("<svg ", '<svg :width="size" :height="size" ').replaceAll('fill="#fff"', ':fill="color"').replaceAll('stroke="#fff"', ':stroke="color"'), 2), `</template>`].join("\n");
    case "svelte": return [`<script>`, `  export let size = 64;`, `  export let color = "currentColor";`, `</script>`, ``, svg.replace("<svg ", "<svg width={size} height={size} ").replaceAll('"#fff"', "{color}")].join("\n");
    case "astro": return [`---`, `const { size = 64, color = "currentColor" } = Astro.props;`, `---`, ``, svg.replace("<svg ", "<svg width={size} height={size} ").replaceAll('"#fff"', "{color}")].join("\n");
    case "react-native": {
      const tags = new Set<string>();
      const body = componentBody(svg).replace(/<\/?([a-zA-Z]+)/g, (m, t: string) => { const T = t[0].toUpperCase() + t.slice(1); if (T !== "Svg") tags.add(T); return m.replace(t, T); });
      return [`import React from "react";`, `import Svg${tags.size ? `, { ${[...tags].sort().join(", ")} }` : ""} from "react-native-svg";`, ``, `export const ${C} = ({ size = 64, color = "currentColor" }) => (`, indent(body, 2), `);`, ``, `export default ${C};`].join("\n");
    }
    case "base64": return `data:image/svg+xml;base64,${btoa(sized(svg))}`;
    case "css": return `background-image: url("data:image/svg+xml;utf8,${encodeURIComponent(sized(svg))}");`;
    default: return "";
  }
}

export const AUCTION_FORMATS = [
  { value: "id", label: "ID" }, { value: "signer", label: "Signer" }, { value: "verify", label: "Verify" }, { value: "link", label: "Link" },
];

export function auctionAs(format: string, a: AuctionSummary, signer?: string): string {
  const link = `${location.origin}/auction/?id=${a.id}`;
  switch (format) {
    case "id": return a.id;
    case "signer": return signer ?? "";
    case "verify": return [`curl -sL ${location.origin}/api/auctions/${a.id}/public.tgz | tar -xz`, `npx -y --package=${location.origin}/dl/benzo-0.1.0.tgz benzo verify --dir public-${a.id.slice(0, 8)} --signer ${signer ?? "<signer>"}`].join("\n");
    case "link": return link;
    default: return "";
  }
}
