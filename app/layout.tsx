import type { Metadata } from "next";
import "./globals.css";
import { ClientLayoutWrapper } from "@/components/ClientLayoutWrapper";
import { UI_THEME_PICKER_ENABLED, UI_THEME_STORAGE_KEY } from "@/lib/uiTheme";

export const metadata: Metadata = {
  title: "DartBoard",
  description: "Local AI environment",
  applicationName: "DartBoard",
  manifest: "/site.webmanifest",
  icons: {
    icon: [
      { url: "/dartboard-hub-icon.svg", type: "image/svg+xml" },
      { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
      { url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
      { url: "/android-chrome-192x192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
    shortcut: ["/dartboard-hub-icon.svg"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const initThemeScript = `(() => {
    try {
      const allowMono = ${UI_THEME_PICKER_ENABLED ? "true" : "false"};
      const raw = localStorage.getItem("${UI_THEME_STORAGE_KEY}");
      const theme = allowMono && raw === "mono" ? "mono" : "brand";
      document.documentElement.setAttribute("data-ui-theme", theme);
      if (document.body) document.body.setAttribute("data-ui-theme", theme);
    } catch {
      document.documentElement.setAttribute("data-ui-theme", "brand");
      if (document.body) document.body.setAttribute("data-ui-theme", "brand");
    }
  })();`;

  return (
    <html lang="en" className="dark" data-ui-theme="brand" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: initThemeScript }} />
      </head>
      <body className="bg-background text-foreground antialiased">
        <ClientLayoutWrapper>{children}</ClientLayoutWrapper>
      </body>
    </html>
  );
}
