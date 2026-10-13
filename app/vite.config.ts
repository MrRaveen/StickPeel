import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// SPA: no server rendering of routes. The build prerenders the document shell
// once to `dist/client/_shell.html`; the host serves that file for every path
// (see `public/_redirects`) and the router takes over on the client.
export default defineConfig({
  resolve: { tsconfigPaths: true },
  plugins: [
    tailwindcss(),
    tanstackStart({ spa: { enabled: true } }),
    viteReact(),
  ],
  optimizeDeps: {
    entries: ["src/**/*.{ts,tsx}"],
    include: [
      "@base-ui/react",
      "@base-ui/react/use-render",
      "@base-ui/react/merge-props",
      "@base-ui/react/dialog",
      "@base-ui/react/button",
      "@base-ui/react/input",
      "@base-ui/react/menu",
      "@base-ui/react/tooltip",
      "@base-ui/react/tabs",
      "@base-ui/react/select",
      "@base-ui/react/checkbox",
      "@base-ui/react/popover",
      "@base-ui/react/separator",
      "@base-ui/react/scroll-area",
      "@base-ui/react/avatar",
      "@base-ui/react/progress",
      "@base-ui/react/slider",
      "@base-ui/react/switch",
      "@base-ui/react/accordion",
      "@base-ui/react/alert-dialog",
      "@base-ui/react/collapsible",
      "@base-ui/react/radio",
      "@base-ui/react/radio-group",
      "@base-ui/react/direction-provider",
      "@base-ui/react/drawer",
      "@base-ui/react/preview-card",
      "@base-ui/react/context-menu",
      "@base-ui/react/menubar",
      "@base-ui/react/navigation-menu",
      "@base-ui/react/toggle",
      "@base-ui/react/toggle-group",
      "lucide-react",
      "clsx",
      "tailwind-merge",
      "class-variance-authority",
      "@tanstack/react-query",
      "@tanstack/react-router",
    ],
  },
});
