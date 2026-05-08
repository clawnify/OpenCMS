import { useEffect, useState, useCallback } from "react";

export function useRouter() {
  const [path, setPath] = useState(() =>
    typeof window === "undefined" ? "/" : window.location.pathname,
  );

  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const navigate = useCallback((next: string) => {
    if (next === window.location.pathname) return;
    window.history.pushState({}, "", next);
    setPath(next);
  }, []);

  return { path, navigate };
}

export function matchPostRoute(path: string): number | null {
  const m = path.match(/^\/posts\/(\d+)$/);
  return m ? Number(m[1]) : null;
}
