"use client";

import { useTheme } from "next-themes";
import { Moon, Sun } from "lucide-react";
import { ActionZones } from "@/components/ActionZones";
import { useEffect, useState } from "react";

export default function Home() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  // Prevent hydration mismatch on theme toggle
  useEffect(() => setMounted(true), []);

  return (
    <main className="min-h-screen bg-gray-100 dark:bg-peer-dark transition-colors duration-300 selection:bg-peer-primary/30 font-sans flex flex-col">
      
      {/* Navbar */}
      <nav className="w-full flex justify-between items-center px-8 py-6">
        <div className="flex items-center gap-3">
          <div className="w-3 h-3 rounded-full bg-peer-primary shadow-[0_0_12px_rgba(0,242,255,0.6)]" />
          <span className="text-xl font-display font-semibold text-gray-900 dark:text-white tracking-wide">
            PeerDrop
          </span>
        </div>
        
        {mounted && (
          <button
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            className="p-2.5 rounded-full bg-white dark:bg-white/5 border border-gray-200 dark:border-white/10 text-gray-600 dark:text-gray-300 hover:text-peer-primary dark:hover:text-peer-primary transition-colors"
          >
            {theme === "dark" ? <Sun size={20} /> : <Moon size={20} />}
          </button>
        )}
      </nav>

      {/* Main Content Area */}
      <div className="flex-1 flex items-center justify-center p-6">
         <ActionZones />
      </div>

    </main>
  );
}