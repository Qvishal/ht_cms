import type { Metadata } from "next";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/lib/theme";

export const metadata: Metadata = {
  title: "HT CMS Admin",
  description: "Headless CMS Admin Panel"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const setInitialThemeScript = `
  (function(){
    try{
      var key = 'ht_cms_theme';
      var raw = localStorage.getItem(key);
      var resolved = 'light';
      if (raw === 'light' || raw === 'dark') resolved = raw;
      else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) resolved = 'dark';
      document.documentElement.dataset.theme = resolved;
      document.documentElement.style.colorScheme = resolved;
    }catch(e){}
  })();`;
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: setInitialThemeScript }} />
      </head>
      <body>
        <ThemeProvider>{children}</ThemeProvider>
        <Toaster richColors closeButton />
      </body>
    </html>
  );
}
