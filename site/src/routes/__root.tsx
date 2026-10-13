import { HeadContent, Scripts, createRootRoute } from "@tanstack/react-router";
import appCss from "@/styles.css?url";

// Document shell for every page. `head` replaces the Next.js `metadata`
// export — add per-route metadata with a `head` on that route's file.
export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "StickPeel" },
      { name: "description", content: "StickPeel weekly planning platform." },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", href: "/official_logo.png?v=2", type: "image/png" },
      { rel: "icon", href: "/favicon.ico?v=2", sizes: "48x48" },
      { rel: "icon", href: "/icon.svg?v=2", type: "image/svg+xml" },
      { rel: "shortcut icon", href: "/official_logo.png?v=2" },
      { rel: "apple-touch-icon", href: "/official_logo.png?v=2" },
    ],
  }),
  shellComponent: RootDocument,
});

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body className="antialiased">
        {children}
        <Scripts />
      </body>
    </html>
  );
}
