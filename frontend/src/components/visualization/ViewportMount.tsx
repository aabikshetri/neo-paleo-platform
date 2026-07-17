import { type ReactNode, useEffect, useRef, useState } from "react";

export default function ViewportMount({ children }: { children: ReactNode }) {
  const anchorRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(() => !("IntersectionObserver" in window));

  useEffect(() => {
    if (ready || !anchorRef.current) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setReady(true);
          observer.disconnect();
        }
      },
      { rootMargin: "350px" }
    );
    observer.observe(anchorRef.current);
    return () => observer.disconnect();
  }, [ready]);

  return (
    <div ref={anchorRef}>
      {ready ? children : (
        <div style={{ minHeight: "220px", display: "grid", placeItems: "center" }}>
          Environmental charts load as you scroll.
        </div>
      )}
    </div>
  );
}
