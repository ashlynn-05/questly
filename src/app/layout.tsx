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
      {/* Not wrapped in <head>: a manual <head> in an App Router layout breaks
          hydration, and an unhydrated tree never attaches the toggle's handler.
          React 19 hoists a bare <script> here on its own. */}
      <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      <body className="min-h-full flex flex-col">
        <ConvexClientProvider initialToken={initialToken}>
          {children}
        </ConvexClientProvider>
      </body>
    </html>
  );
}
