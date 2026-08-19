// @ts-check
import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";

// Static-first showcase for blobkin (blobatar + the bloub motion engine).
// No UI framework: the library itself is framework-agnostic vanilla TS, so
// every interactive demo is a plain `<script type="module">` island reading
// blobatar/blobatar-engine straight from the workspace-linked package (see
// package.json's `"blobatar": "file:../.."`).
export default defineConfig({
  site: "https://bolota.adam-ousmer.dev",
  output: "static",
  compressHTML: true,
  build: {
    inlineStylesheets: "auto",
  },
  integrations: [sitemap()],
});
