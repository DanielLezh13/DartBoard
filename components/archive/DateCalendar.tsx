"use client";

import React from "react";

interface DateCalendarProps {
  year: number;
  month: number;
  selectedDates: string[];
  onDayClick: (ymd: string, event: React.MouseEvent) => void;
  formatYMD: (year: number, month: number, day: number) => string;
  getDaysInMonth: (year: number, month: number) => number;
  onSelectAll?: (year: number, month: number) => void;
  onClearMonth?: (year: number, month: number) => void;
  isDragging?: boolean;
  dragMode?: "select" | "deselect" | null;
  onDayDragStart?: (ymd: string) => void;
  onDayDrag?: (ymd: string) => void;
}

export default function DateCalendar({
  year,
  month,
  selectedDates,
  onDayClick,
  formatYMD,
  getDaysInMonth,
  onSelectAll,
  onClearMonth,
  isDragging = false,
  dragMode = null,
  onDayDragStart,
  onDayDrag,
}: DateCalendarProps) {
  const daysInMonth = getDaysInMonth(year, month);
  const monthName = new Date(year, month, 1).toLocaleDateString("en-US", { month: "long" });
  const monthDates = Array.from({ length: daysInMonth }, (_, i) => formatYMD(year, month, i + 1));
  const allSelectedInMonth = monthDates.every((d) => selectedDates.includes(d));
  const someSelectedInMonth = monthDates.some((d) => selectedDates.includes(d));
  const dayCells = Array.from({ length: 31 }, (_, i) => i + 1).map((day) => {
    const inMonth = day <= daysInMonth;
    const ymd = inMonth ? formatYMD(year, month, day) : null;
    const isSelected = ymd ? selectedDates.includes(ymd) : false;

    const handleMouseDown = (e: React.MouseEvent) => {
      if (!ymd) return;
      e.preventDefault();
      if (onDayDragStart) {
        onDayDragStart(ymd);
      }
    };

    const handleMouseEnter = () => {
      if (ymd && isDragging && dragMode && onDayDrag) {
        onDayDrag(ymd);
      }
    };

    if (!inMonth) {
      return (
        <div
          key={`empty-${day}`}
          className="h-5 rounded-[3px] border border-transparent bg-slate-950/35"
        />
      );
    }

    return (
      <button
        key={day}
        onClick={(e) => {
          // Only handle click if not dragging
          if (!isDragging && ymd) {
            onDayClick(ymd, e);
          }
        }}
        onMouseDown={handleMouseDown}
        onMouseEnter={handleMouseEnter}
        className={[
          "h-5 flex items-center justify-center text-[9px] transition-colors rounded-[3px]",
          "border select-none",
          "focus:outline-none focus-visible:ring-1 focus-visible:ring-blue-400 select-none",
          isSelected
            ? "bg-blue-600/90 text-white border-blue-400/60 shadow-[0_0_0_1px_rgba(96,165,250,0.35)_inset]"
            : "bg-slate-950/70 text-gray-200 border-slate-700/70 hover:bg-slate-800/80 hover:border-slate-500/80",
        ].join(" ")}
      >
        {day}
      </button>
    );
  });

  return (
    <div className="w-full rounded-md border border-blue-500/20 bg-slate-900/45 px-1.5 py-1">
      <div className="flex items-center gap-1">
        <div className="w-[82px] shrink-0">
          <h3 className="truncate text-[10px] font-semibold leading-none text-gray-200" title={monthName}>
            {monthName}
          </h3>
        </div>
        <div className="w-[42px] shrink-0">
          {onSelectAll ? (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onSelectAll(year, month);
              }}
              className={[
                "h-5 w-full rounded border px-1 text-[8px] transition-colors",
                allSelectedInMonth
                  ? "bg-blue-600/20 border-blue-500/50 text-blue-300"
                  : "bg-gray-800/30 border-gray-700/50 text-gray-400 hover:border-blue-500/50 hover:text-blue-300",
              ].join(" ")}
              title="Select all days in this month"
            >
              All
            </button>
          ) : (
            <div className="h-5 w-full" />
          )}
        </div>
        <div className="w-[46px] shrink-0">
          {onClearMonth ? (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onClearMonth(year, month);
              }}
              disabled={!someSelectedInMonth}
              className={[
                "h-5 w-full rounded border px-1 text-[8px] transition-colors",
                someSelectedInMonth
                  ? "bg-gray-800/30 border-gray-700/50 text-gray-400 hover:border-red-500/50 hover:text-red-300"
                  : "bg-gray-900/35 border-gray-800/70 text-gray-600 cursor-default opacity-55",
              ].join(" ")}
              title="Clear all selected days in this month"
            >
              Clear
            </button>
          ) : (
            <div className="h-5 w-full" />
          )}
        </div>
        <div
          className="grid gap-px flex-1 min-w-0"
          style={{ gridTemplateColumns: "repeat(31, minmax(0, 1fr))" }}
        >
          {dayCells}
        </div>
      </div>
    </div>
  );
}
