// Time Utilities

export const getCurrentTimestamp = (): Date => {
  return new Date();
};

export const addMilliseconds = (date: Date, milliseconds: number): Date => {
  return new Date(date.getTime() + milliseconds);
};

export const getTimeDifference = (date1: Date, date2: Date): number => {
  return Math.abs(date1.getTime() - date2.getTime());
};
