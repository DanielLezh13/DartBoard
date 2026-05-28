"use client";

import { useEffect, useState, useRef } from "react";

interface Toast {
  id: string;
  message: string;
  duration?: number;
}

export function useToast() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const recentMessages = useRef<Set<string>>(new Set());

  const showToast = (message: string, duration = 2250) => {
    // Dedupe: if the same message was shown in the last 100ms, skip
    if (recentMessages.current.has(message)) {
      return null;
    }
    
    // Add to recent messages
    recentMessages.current.add(message);
    
    // Clear from recent messages after 100ms
    setTimeout(() => {
      recentMessages.current.delete(message);
    }, 100);
    
    const id = Date.now().toString();
    const newToast: Toast = { id, message, duration };
    
    setToasts(prev => [...prev, newToast]);
    
    if (duration > 0) {
      setTimeout(() => {
        setToasts(prev => prev.filter(t => t.id !== id));
      }, duration);
    }
    
    return id;
  };

  const removeToast = (id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  };

  return { showToast, removeToast, toasts };
}

export function ToastContainer({
  toasts,
  containerClassName,
}: {
  toasts: Toast[];
  containerClassName?: string;
}) {
  return (
    <div className={containerClassName ?? "fixed top-4 right-4 z-[2000] space-y-2"}>
      {toasts.map(toast => (
        <div
          key={toast.id}
          className="w-fit max-w-[340px] bg-gray-800 text-white px-3 py-1.5 rounded-lg shadow-lg border border-blue-300/70 animate-[fadeIn_0.2s_ease-out]"
        >
          <span className="block text-sm leading-snug text-center whitespace-pre-wrap break-words">
            {toast.message}
          </span>
        </div>
      ))}
    </div>
  );
}
