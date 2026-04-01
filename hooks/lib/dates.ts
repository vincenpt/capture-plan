// dates.ts — Date/time helpers

// ---- Date Helpers ----

export type DateParts = {
  dd: string;
  mm: string;
  yyyy: string;
  monthName: string;
  dayName: string;
  dateKey: string;
  hh: string;
  min: string;
  datetime: string;
  timeStr: string;
  ampmTime: string;
};

export function formatAmPm(hours: number, minutes: number): string {
  const period = hours >= 12 ? "PM" : "AM";
  const h = hours % 12 || 12;
  return `${h}:${String(minutes).padStart(2, "0")} ${period}`;
}

export function getDatePartsFor(date: Date): DateParts {
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const yyyy = String(date.getFullYear());
  const hh = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  const monthName = new Intl.DateTimeFormat("en-US", { month: "long" }).format(date);
  const dayName = new Intl.DateTimeFormat("en-US", { weekday: "long" }).format(date);
  return {
    dd,
    mm,
    yyyy,
    monthName,
    dayName,
    hh,
    min,
    dateKey: `${yyyy}-${mm}-${dd}`,
    datetime: `${yyyy}-${mm}-${dd}T${hh}:${min}`,
    timeStr: `${hh}:${min}`,
    ampmTime: formatAmPm(date.getHours(), date.getMinutes()),
  };
}

export function getDateParts(): DateParts {
  return getDatePartsFor(new Date());
}

// ---- Duration Formatting ----

export function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) {
    return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (remainingMinutes > 0) return `${hours}h ${remainingMinutes}m`;
  return `${hours}h`;
}
