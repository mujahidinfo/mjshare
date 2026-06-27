import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "MJShare — peer-to-peer file transfer",
  description:
    "Zero-server-storage P2P file sharing for devices on your network. Files stream directly between browsers over an encrypted WebRTC channel and never touch a server.",
};

export const viewport: Viewport = {
  themeColor: "#020617",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Runs before first paint to apply the saved theme (defaults to dark),
  // avoiding a flash of the wrong theme on load.
  const themeBoot = `(function(){try{var t=localStorage.getItem('mjshare:theme')||'dark';var r=document.documentElement;if(t==='dark')r.classList.add('dark');else r.classList.remove('dark');r.style.colorScheme=t;}catch(e){document.documentElement.classList.add('dark');}})();`;

  return (
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBoot }} />
      </head>
      <body className="min-h-dvh font-sans">{children}</body>
    </html>
  );
}
