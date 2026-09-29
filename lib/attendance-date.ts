export function isMondayDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;

  const date = new Date(`${value}T12:00:00`);
  return (
    !Number.isNaN(date.getTime()) &&
    date.getFullYear() === Number(value.slice(0, 4)) &&
    date.getMonth() + 1 === Number(value.slice(5, 7)) &&
    date.getDate() === Number(value.slice(8, 10)) &&
    date.getDay() === 1
  );
}

export function getRequestedMondayDate(
  candidate: string | string[] | undefined,
  fallback: string,
) {
  const value = Array.isArray(candidate) ? candidate[0] : candidate;
  return value && isMondayDate(value) ? value : fallback;
}
