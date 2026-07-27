import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Toaster } from "react-hot-toast";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Ottodot Trial Booking",
  description: "Secure and reliable trial booking system",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${inter.className} min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 text-slate-900`}>
        {children}
        <Toaster position="bottom-right" />
      </body>
    </html>
  );
}
