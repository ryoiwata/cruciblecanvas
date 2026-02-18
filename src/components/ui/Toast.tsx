"use client";

import { useEffect, useState } from "react";

interface ToastProps {
  message: string;
  visible: boolean;
  onDismiss: () => void;
  duration?: number;
}

export default function Toast({
  message,
  visible,
  onDismiss,
  duration = 3000,
}: ToastProps) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (visible) {
      // Trigger enter animation
      requestAnimationFrame(() => setShow(true));
      const timer = setTimeout(() => {
        setShow(false);
        // Wait for exit animation before calling onDismiss
        setTimeout(onDismiss, 200);
      }, duration);
      return () => clearTimeout(timer);
    } else {
      setShow(false);
    }
  }, [visible, duration, onDismiss]);

  if (!visible) return null;

  return (
    <div
      className={`fixed bottom-6 left-1/2 z-[100] -translate-x-1/2 transition-all duration-200 ${
        show ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0"
      }`}
    >
      <div className="rounded-lg bg-gray-900 px-4 py-2.5 text-sm text-white shadow-lg">
        {message}
      </div>
    </div>
  );
}
