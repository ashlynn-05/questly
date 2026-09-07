import type { Metadata } from "next";
import { Archivo } from "next/font/google";
import "./globals.css";
import { ConvexClientProvider } from "./ConvexClientProvider";
import { getToken } from "@/lib/auth-server";
import { themeScript } from "@/components/questly/theme";

// One superfamily, two axes. The width axis is what makes this a signage face
// rather than a UI face -- display type lives at wdth 125, text at 100.
const archivo = Archivo({
  variable: "--font-archivo",
  subsets: ["latin"],
  axes: ["wdth"],
});

export const metadata: Metadata = {
  title: "Questly",
  description: "Turns \"we should catch up\" into a plan, in two taps.",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Handing the token to the provider avoids an unauthenticated first paint.
  const initialToken = await getToken();

  return (
    <html lang="en" className={`${archivo.variable} h-full antialiased`} suppressHydrationWarning>
      {/* Runs before first paint so a light-mode visitor never sees a dark
          flash. React 19 hoists a bare <script> in a layout into <head> on its
          own, so no manual <head> wrapper is needed -- the Next 16 guide
          (node_modules/next/dist/docs/01-app/02-guides/preventing-flash-before-hydration.md)
          writes one, and either works; the earlier comment here claimed a
          manual <head> breaks hydration, which the docs contradict. */}
      <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      <body className="min-h-full flex flex-col">
        <ConvexClientProvider initialToken={initialToken}>
          {children}
        </ConvexClientProvider>
      </body>
    </html>
  );
}
