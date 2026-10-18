import { useSyncExternalStore } from "react";

function subscribe(onChange: () => void) {
  window.addEventListener("popstate", onChange);
  return () => window.removeEventListener("popstate", onChange);
}

const readPath = () => window.location.pathname;

/** Push a new URL and notify the router (pushState does not fire popstate by itself). */
export function navigate(path: string) {
  if (window.location.pathname === path) return;
  window.history.pushState(null, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

/** Current pathname, re-rendering on navigation and back/forward. */
export function usePathname(): string {
  return useSyncExternalStore(subscribe, readPath, () => "/");
}
