import { useEffect, useState } from "react";

interface AnnouncerProps {
  message?: string;
  politeness?: "polite" | "assertive";
}

export function AccessibilityAnnouncer({ message = "", politeness = "polite" }: AnnouncerProps) {
  const [announcement, setAnnouncement] = useState(message);

  useEffect(() => {
    if (message) {
      setAnnouncement(message);
      // Clear after a delay to allow re-announcing the same message
      const timer = setTimeout(() => setAnnouncement(""), 100);
      return () => clearTimeout(timer);
    }
  }, [message]);

  return (
    <div
      role="status"
      aria-live={politeness}
      aria-atomic="true"
      className="sr-only"
      data-testid="accessibility-announcer"
    >
      {announcement}
    </div>
  );
}
