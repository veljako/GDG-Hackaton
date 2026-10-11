export function dateFromIso(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day, 12);
  return dateToIso(date) === value ? date : null;
}

export function dateToIso(date: Date | null): string {
  if (!date) return "";
  return `${String(date.getFullYear()).padStart(4, "0")}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function moveMonth(date: Date, offset: number): Date {
  const month = new Date(date.getFullYear(), date.getMonth() + offset, 1, 12);
  const lastDay = new Date(
    month.getFullYear(),
    month.getMonth() + 1,
    0,
  ).getDate();
  month.setDate(Math.min(date.getDate(), lastDay));
  return month;
}

export function calendarDays(month: Date): Date[] {
  const first = new Date(month.getFullYear(), month.getMonth(), 1, 12);
  first.setDate(1 - ((first.getDay() + 6) % 7));
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(first);
    date.setDate(first.getDate() + index);
    return date;
  });
}
