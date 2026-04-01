/**
 * Utilitário para trabalhar com timezones em agendamentos
 */

import { DispatchSchedule } from '../types/dispatch';
import { DEFAULT_TIMEZONE } from '../config/constants';

const isValidTimezone = (timezone: string): boolean => {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
};

export const getScheduleTimezone = (
  schedule: DispatchSchedule | null,
  userTimezone: string
): string => {
  if (schedule?.timezone && isValidTimezone(schedule.timezone)) {
    return schedule.timezone;
  }
  if (userTimezone && isValidTimezone(userTimezone)) {
    return userTimezone;
  }
  return DEFAULT_TIMEZONE;
};

/**
 * Hora atual no fuso, sempre "HH:mm" (24h) — evita bugs de toLocaleTimeString (en-US pode variar).
 */
export const formatHHmmInTimezone = (date: Date, timeZone: string): string => {
  const validTz = isValidTimezone(timeZone) ? timeZone : DEFAULT_TIMEZONE;
  const dtf = new Intl.DateTimeFormat('en-GB', {
    timeZone: validTz,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = dtf.formatToParts(date);
  let h = parts.find((p) => p.type === 'hour')?.value ?? '00';
  const m = parts.find((p) => p.type === 'minute')?.value ?? '00';
  if (h === '24') h = '00';
  return `${h.padStart(2, '0')}:${m.padStart(2, '0')}`;
};

/** Dia da semana no fuso: 0=domingo … 6=sábado */
export const getWeekdayInTimezone = (date: Date, timeZone: string): number => {
  const validTz = isValidTimezone(timeZone) ? timeZone : DEFAULT_TIMEZONE;
  const short = new Intl.DateTimeFormat('en-US', {
    timeZone: validTz,
    weekday: 'short',
  }).format(date);
  const map: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  return map[short] ?? date.getUTCDay();
};

/** "8:00" ou "08:30" → minutos desde meia-noite */
export const timeStringToMinutes = (t: string | undefined): number => {
  if (!t || typeof t !== 'string') return NaN;
  const match = /^(\d{1,2}):(\d{2})$/.exec(t.trim());
  if (!match) return NaN;
  const hh = parseInt(match[1], 10);
  const mm = parseInt(match[2], 10);
  if (hh > 23 || mm > 59) return NaN;
  return hh * 60 + mm;
};

/**
 * Converter data/hora local para UTC considerando o timezone
 * Usa uma abordagem mais simples e confiável
 */
export const convertToUTC = (
  dateStr: string,
  timeStr: string,
  timezone: string
): Date => {
  const validTimezone = isValidTimezone(timezone) ? timezone : DEFAULT_TIMEZONE;

  const [year, month, day] = dateStr.split('-').map(Number);
  const [hour, minute] = timeStr.split(':').map(Number);

  const localDate = new Date(year, month - 1, day, hour, minute, 0, 0);

  const tzDateStr = localDate.toLocaleString('en-US', {
    timeZone: validTimezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  const parts = tzDateStr.split(/[/,\s:]/);
  const tzMonth = parseInt(parts[0], 10);
  const tzDay = parseInt(parts[1], 10);
  const tzYear = parseInt(parts[2], 10);
  const tzHour = parseInt(parts[3], 10);
  const tzMinute = parseInt(parts[4], 10);

  const tzDateUTC = new Date(Date.UTC(tzYear, tzMonth - 1, tzDay, tzHour, tzMinute, 0));

  const desiredUTC = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
  const offset = desiredUTC.getTime() - tzDateUTC.getTime();

  return new Date(desiredUTC.getTime() - offset);
};

/**
 * Já passou a data/hora de início do agendamento (no fuso do usuário/agenda).
 */
export const hasStartDatePassed = (
  schedule: DispatchSchedule | null,
  userTimezone: string
): boolean => {
  if (!schedule || !schedule.startDate) {
    return true;
  }

  const timezone = getScheduleTimezone(schedule, userTimezone);
  const now = new Date();

  try {
    const nowDateStr = now.toLocaleDateString('en-CA', { timeZone: timezone });

    if (schedule.startDate > nowDateStr) {
      return false;
    }
    if (schedule.startDate < nowDateStr) {
      return true;
    }

    if (!schedule.startTime) {
      return true;
    }

    const nowMin = timeStringToMinutes(formatHHmmInTimezone(now, timezone));
    const startMin = timeStringToMinutes(schedule.startTime);
    if (Number.isNaN(nowMin) || Number.isNaN(startMin)) {
      return true;
    }
    return nowMin >= startMin;
  } catch {
    return true;
  }
};

/**
 * Está dentro da janela diária [startTime, endTime] no fuso da agenda.
 */
export const isWithinAllowedHours = (
  schedule: DispatchSchedule,
  userTimezone: string
): boolean => {
  const timezone = getScheduleTimezone(schedule, userTimezone);
  const { startTime, endTime } = schedule;

  if (!startTime || !endTime) {
    return true;
  }

  const now = new Date();

  try {
    const nowMin = timeStringToMinutes(formatHHmmInTimezone(now, timezone));
    const startMin = timeStringToMinutes(startTime);
    const endMin = timeStringToMinutes(endTime);

    if (Number.isNaN(nowMin) || Number.isNaN(startMin) || Number.isNaN(endMin)) {
      return true;
    }

    if (startMin <= endMin) {
      return nowMin >= startMin && nowMin <= endMin;
    }
    /* Janela atravessa meia-noite */
    return nowMin >= startMin || nowMin <= endMin;
  } catch {
    return false;
  }
};
