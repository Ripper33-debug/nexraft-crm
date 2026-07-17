import { useEffect, useRef } from "react";
import { useRouter } from "@tanstack/react-router";

import { useAutoConfig, runAutoDiscovery } from "../../lib/crm/autodiscover";

// Invisible engine mounted app-wide in the layout. While auto-discovery is on and
// an area is set, it runs the background sweep and refreshes the router whenever
// new leads are imported so they appear on Opportunities/Pipeline right away.
export function AutoDiscovery() {
  const router = useRouter();
  const config = useAutoConfig();

  const areaRef = useRef(config.area);
  areaRef.current = config.area;
  const onRef = useRef(config.on);
  onRef.current = config.on;

  useEffect(() => {
    if (!config.on || !config.area.trim()) return;
    let cancelled = false;
    void runAutoDiscovery(
      () => areaRef.current,
      () => cancelled || !onRef.current,
      () => router.invalidate(),
    );
    return () => {
      cancelled = true;
    };
  }, [config.on, config.area, router]);

  return null;
}
