"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "./icons";

type Theme = "light" | "dark";
const KEY = "mjshare:theme";

/** Read the theme the inline boot script already applied to <html>. */
function currentTheme(): Theme {
  if (typeof document === "undefined") return "dark";
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  root.classList.toggle("dark", theme === "dark");
  root.style.colorScheme = theme;
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* private mode — ignore */
  }
}

/** Light/dark switch. The actual initial theme is set pre-paint in layout.tsx. */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("dark");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setTheme(currentTheme());
    setMounted(true);
  }, []);

  const toggle = () => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    applyTheme(next);
  };

  const isDark = theme === "dark";

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={`Switch to ${isDark ? "light" : "dark"} mode`}
      title={`Switch to ${isDark ? "light" : "dark"} mode`}
      className="focus-ring glass-hover flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg border border-[var(--border)] text-[var(--text-muted)]"
    >
      {/* Avoid an icon flash before we know the theme. */}
      {mounted ? (isDark ? <Moon size={17} /> : <Sun size={17} />) : <span className="h-[17px] w-[17px]" />}
    </button>
  );
}
