// Every Xatlov object must be completed by this date.
const deadline = '2027-12-31';

// Official non-working holidays of Uzbekistan up to the deadline.
// Ramazon and Qurbon hayiti dates are announced each year; correct them here once they are.
const holidays = [
  ['2026-12-08', 'Konstitutsiya kuni'],
  ['2027-01-01', 'Yangi yil'],
  ['2027-03-08', 'Xalqaro xotin-qizlar kuni'],
  ['2027-03-10', 'Ramazon hayiti'],
  ['2027-03-21', 'Navro‘z bayrami'],
  ['2027-05-09', 'Xotira va qadrlash kuni'],
  ['2027-05-16', 'Qurbon hayiti'],
  ['2027-09-01', 'Mustaqillik kuni'],
  ['2027-10-01', 'O‘qituvchi va murabbiylar kuni'],
  ['2027-12-08', 'Konstitutsiya kuni'],
] as const;

type WorkWeek = 5 | 6;
const iso = (date: Date) => date.toISOString().slice(0, 10);
const isWorkingDay = (date: Date, workWeek: WorkWeek) => date.getUTCDay() !== 0 && (workWeek === 6 || date.getUTCDay() !== 6);

// A holiday that falls on a day off moves to the next working day.
function holidayDays(workWeek: WorkWeek) {
  const days = new Set<string>();
  for (const [value] of holidays) {
    const date = new Date(`${value}T00:00:00.000Z`);
    while (!isWorkingDay(date, workWeek) || days.has(iso(date))) date.setUTCDate(date.getUTCDate() + 1);
    days.add(iso(date));
  }
  return days;
}

// Working days left after the given date up to the deadline, holidays excluded.
function workDays(after: Date, workWeek: WorkWeek) {
  const off = holidayDays(workWeek);
  let days = 0;
  for (const date = new Date(after); iso(date) < deadline;) {
    date.setUTCDate(date.getUTCDate() + 1);
    if (isWorkingDay(date, workWeek) && !off.has(iso(date))) days++;
  }
  return days;
}

// First day of the last `count` working days of a 5-day week (holidays excluded) ending on the given date.
export function lastWorkDaysStart(date: Date, count: number) {
  const off = holidayDays(5);
  const start = new Date(date);
  for (let found = 0; ; start.setUTCDate(start.getUTCDate() - 1)) {
    if (isWorkingDay(start, 5) && !off.has(iso(start)) && ++found === count) return start;
  }
}

export function xatlovPlan(after: Date) {
  return {
    deadline,
    fiveDayWorkDays: workDays(after, 5),
    sixDayWorkDays: workDays(after, 6),
    holidays: holidays.filter(([date]) => date > iso(after)).map(([date, name]) => ({ date, name })),
    // Days off of a 5-day week caused by holidays, for the finish-date forecast.
    fiveDayDaysOff: [...holidayDays(5)].filter((date) => date > iso(after)),
  };
}
