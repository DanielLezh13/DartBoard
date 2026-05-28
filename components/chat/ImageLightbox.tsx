"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { Copy, Download, X } from "lucide-react";
import { useToast } from "@/components/ui/Toast";

interface ImageLightboxProps {
  imageUrl: string;
  alt?: string;
  onClose: () => void;
}

const downloadImage = (imageUrl: string) => {
  if (typeof window === "undefined") return;
  const link = document.createElement("a");
  link.href = imageUrl;
  const lastSegment = imageUrl.split("/").pop() || "image";
  const cleanName = lastSegment.split("?")[0] || "image";
  link.download = cleanName;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

const copyImage = async (imageUrl: string): Promise<"image" | "url"> => {
  if (typeof navigator === "undefined" || !navigator.clipboard) {
    throw new Error("Clipboard is not available.");
  }

  const response = await fetch(imageUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch image (${response.status}).`);
  }

  const blob = await response.blob();
  const hasClipboardItem = typeof window !== "undefined" && "ClipboardItem" in window;

  if (hasClipboardItem) {
    await navigator.clipboard.write([
      // eslint-disable-next-line no-undef
      new ClipboardItem({ [blob.type || "image/png"]: blob }),
    ]);
    return "image";
  }

  await navigator.clipboard.writeText(imageUrl);
  return "url";
};

export function ImageLightbox({ imageUrl, alt = "Expanded image preview", onClose }: ImageLightboxProps) {
  const { showToast } = useToast();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const handleDownload = () => {
    try {
      downloadImage(imageUrl);
    } catch {
      showToast("Could not download image.");
    }
  };

  const handleCopy = async () => {
    try {
      const copiedType = await copyImage(imageUrl);
      showToast(copiedType === "image" ? "Image copied." : "Image URL copied.");
    } catch {
      showToast("Could not copy image.");
    }
  };

  const lightbox = (
    <div
      className="fixed inset-0 z-[2200] flex items-center justify-center bg-black/80 p-4"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div className="relative max-h-[88vh] max-w-[92vw]" onClick={(event) => event.stopPropagation()}>
        {/* eslint-disable-next-line @next/next/no-img-element -- supports arbitrary runtime image URLs in lightbox */}
        <img
          src={imageUrl}
          alt={alt}
          className="max-h-[88vh] max-w-[92vw] rounded-lg border border-white/20 object-contain shadow-[0_20px_60px_rgba(0,0,0,0.65)]"
        />

        <div className="absolute right-2 top-2 flex items-center gap-2">
          <button
            type="button"
            onClick={handleCopy}
            className="inline-flex h-8 items-center gap-1.5 rounded-full border border-white/30 bg-black/65 px-3 text-xs font-medium text-white hover:bg-black/80"
            aria-label="Copy image"
          >
            <Copy className="h-3.5 w-3.5" />
            Copy
          </button>
          <button
            type="button"
            onClick={handleDownload}
            className="inline-flex h-8 items-center gap-1.5 rounded-full border border-white/30 bg-black/65 px-3 text-xs font-medium text-white hover:bg-black/80"
            aria-label="Download image"
          >
            <Download className="h-3.5 w-3.5" />
            Download
          </button>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/40 bg-black/70 text-white hover:bg-black/85"
            aria-label="Close image preview"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );

  if (typeof document === "undefined") {
    return lightbox;
  }

  return createPortal(lightbox, document.body);
}
