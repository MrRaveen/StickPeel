import { HeadContent, Scripts, createRootRoute } from "@tanstack/react-router";
import { QueryProvider } from "@/components/QueryProvider";
import { UserProvider } from "@/contexts/user-context";
import { Toaster } from "@/components/ui/sonner";
import appCss from "@/styles.css?url";

// Document shell for the whole app. In SPA mode this is what gets prerendered
// into `_shell.html`, so everything here runs before any route does.
export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "StickPeel Internal" },
      {
        name: "description",
        content: "StickPeel internal console for platform staff.",
      },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", href: "/official_logo.png?v=2", type: "image/png" },
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
        <QueryProvider>
          <UserProvider>
            {children}
            <Toaster />
          </UserProvider>
        </QueryProvider>
        <Scripts />
      </body>
    </html>
  );
}
