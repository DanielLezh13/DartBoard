"use client";

import {
  buildArchivePaginationPageNumbers,
  type ArchivePaginationPageNumber,
} from "@/lib/archive/pagination";

type ArchivePaginationControlsProps = {
  placement: "top" | "bottom";
  totalPages: number;
  selectedPageIndex: number;
  windowPageIndex: number;
  totalResults: number;
  loading: boolean;
  onPageChange: (pageIndex: number) => void;
};

export default function ArchivePaginationControls({
  placement,
  totalPages,
  selectedPageIndex,
  windowPageIndex,
  totalResults,
  loading,
  onPageChange,
}: ArchivePaginationControlsProps) {
  if (totalPages <= 1) {
    return null;
  }

  const pageNumbers = buildArchivePaginationPageNumbers(totalPages, windowPageIndex);
  const currentPageNum = selectedPageIndex + 1;
  const shellClassName =
    "group relative isolate overflow-hidden rounded-xl border border-blue-500/30 bg-card/60 px-5 py-4 shadow-none backdrop-blur-md";
  const label = placement === "top" ? "Results Navigator" : "Continue Browsing";
  const buttonClassName =
    "rounded-lg border border-blue-500/20 bg-slate-700/50 px-3.5 py-2 text-sm font-medium text-gray-200 backdrop-blur-sm transition-[border-color,background-color,color] duration-150 hover:border-blue-400/40 hover:bg-blue-500/10 hover:text-blue-300 disabled:cursor-default disabled:opacity-40";

  return (
    <div className={shellClassName}>
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(59,130,246,0.12),_transparent_62%)]" />
      <div className="relative flex flex-col gap-3">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-3">
            <div className="h-2.5 w-2.5 rounded-full bg-blue-400 shadow-[0_0_16px_rgba(96,165,250,0.8)]" />
            <div>
              <p className="text-sm font-semibold text-gray-100">{label}</p>
              <p className="text-xs text-blue-100/70">
                Page {currentPageNum} of {totalPages}
              </p>
            </div>
          </div>
          <div className="text-xs text-blue-100/65">
            {totalResults.toLocaleString()} results across {totalPages} pages
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              const previousPage = selectedPageIndex - 1;
              if (previousPage >= 0) {
                onPageChange(previousPage);
              }
            }}
            disabled={selectedPageIndex === 0 || loading}
            className={buttonClassName}
          >
            ← Previous
          </button>

          <div className="flex flex-wrap items-center justify-center gap-2">
            {pageNumbers.map((pageNumber, index) => {
              if (pageNumber === "...") {
                return (
                  <span
                    key={`ellipsis-${placement}-${index}`}
                    className="px-2 text-sm text-blue-100/45"
                  >
                    ...
                  </span>
                );
              }

              return (
                  <PaginationPageButton
                    key={`${placement}-${pageNumber}`}
                    pageNumber={pageNumber}
                    selectedPageIndex={selectedPageIndex}
                    loading={loading}
                    onPageChange={onPageChange}
                  />
              );
            })}
          </div>

          <button
            type="button"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              const nextPage = selectedPageIndex + 1;
              if (nextPage < totalPages) {
                onPageChange(nextPage);
              }
            }}
            disabled={selectedPageIndex >= totalPages - 1 || loading}
            className={buttonClassName}
          >
            Next →
          </button>
        </div>
      </div>
    </div>
  );
}

type PaginationPageButtonProps = {
  pageNumber: Exclude<ArchivePaginationPageNumber, "...">;
  selectedPageIndex: number;
  loading: boolean;
  onPageChange: (pageIndex: number) => void;
};

function PaginationPageButton({
  pageNumber,
  selectedPageIndex,
  loading,
  onPageChange,
}: PaginationPageButtonProps) {
  const pageIndex = pageNumber - 1;
  const isCurrentPage = pageIndex === selectedPageIndex;

  return (
    <button
      type="button"
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        if (pageIndex !== selectedPageIndex && !loading) {
          onPageChange(pageIndex);
        }
      }}
      disabled={loading}
      className={`min-w-[2.75rem] rounded-lg border px-3.5 py-2 text-sm font-medium backdrop-blur-sm ${
        isCurrentPage
          ? "border-blue-400 bg-blue-500/30 text-blue-200 shadow-[0_0_12px_rgba(59,130,246,0.4)]"
          : "border-blue-500/20 bg-slate-700/50 text-gray-200 transition-[border-color,background-color,color] duration-150 hover:border-blue-400/40 hover:bg-blue-500/10 hover:text-blue-300 disabled:cursor-default disabled:opacity-40"
      }`}
      aria-current={isCurrentPage ? "page" : undefined}
      data-page-active={isCurrentPage ? "true" : "false"}
    >
      {pageNumber}
    </button>
  );
}
