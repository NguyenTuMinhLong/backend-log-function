'use strict';

const pool = require('../config/db');
const solarLunar = require('solarlunar');

/*
============================================================
SEASON SERVICE - Mùa cao điểm & Ngày lễ
============================================================

Cung cấp các function để:
- Detect mùa cao điểm dựa trên departure date
- Check ngày lễ
- Lấy season multiplier cho pricing

Chỉ return season info khi CÓ mùa cao điểm/ngày lễ

Cache: 1 giờ để tránh query DB quá nhiều
============================================================
*/

const CACHE_TTL_MS = 60 * 60 * 1000;

// Cache để tránh query DB quá nhiều (invalid sau 1 giờ)
let seasonCache = null;
let seasonCacheTime = 0;
let holidayCache = null;
let holidayCacheTime = 0;
let holidayRuleCache = null;
let holidayRuleCacheTime = 0;
const overrideCache = new Map();
const OVERRIDE_CACHE_TTL_MS = 60 * 60 * 1000;

const getDateParts = (date) => {
  const d = new Date(date);
  return {
    year: d.getFullYear(),
    month: d.getMonth() + 1,
    day: d.getDate(),
  };
};

const normalizeDate = (date) => {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
};

const toDateKey = (date) => normalizeDate(date).toISOString().split('T')[0];

const compareMonthDay = (leftMonth, leftDay, rightMonth, rightDay) => {
  if (leftMonth !== rightMonth) {
    return leftMonth - rightMonth;
  }
  return leftDay - rightDay;
};

const createSeasonBoundaryDate = (year, month, day) => {
  return new Date(year, month - 1, day || 1);
};

const createResolvedDateFromParts = (year, month, day) => new Date(year, month - 1, day);

const parseBoolean = (value) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    return ['true', '1', 'yes'].includes(value.trim().toLowerCase());
  }
  return Boolean(value);
};

const resolveSolarHolidayDate = (rule, year) => {
  return createResolvedDateFromParts(year, Number(rule.anchor_month), Number(rule.anchor_day));
};

const resolveLunarHolidayDate = (rule, year) => {
  const solar = solarLunar.lunar2solar(
    Number(year),
    Number(rule.anchor_month),
    Number(rule.anchor_day),
    parseBoolean(rule.anchor_is_leap_month)
  );

  return createResolvedDateFromParts(solar.cYear, solar.cMonth, solar.cDay);
};

const resolveRuleAnchorDate = (rule, year) => {
  if (rule.calendar_type === 'lunar') {
    return resolveLunarHolidayDate(rule, year);
  }
  return resolveSolarHolidayDate(rule, year);
};

const resolveHolidayRuleForYear = (rule, year) => {
  try {
    const anchorDate = resolveRuleAnchorDate(rule, year);
    const offsetDays = Number(rule.offset_days || 0);
    const resolvedDate = new Date(anchorDate);
    resolvedDate.setDate(resolvedDate.getDate() + offsetDays);

    return {
      ...rule,
      resolved_year: year,
      resolved_date: resolvedDate,
      resolved_date_key: toDateKey(resolvedDate),
      resolved_anchor_date: anchorDate,
      multiplier: parseFloat(rule.multiplier),
      priority: Number(rule.priority || 0),
      is_resolved_from_rule: true,
    };
  } catch (error) {
    console.error(`[SeasonService] Failed to resolve holiday rule ${rule.name} for year ${year}:`, error.message);
    return null;
  }
};

const buildResolvedHolidayRuleMap = (rules, years) => {
  const ruleMap = new Map();

  for (const rule of rules) {
    for (const year of years) {
      const resolvedRule = resolveHolidayRuleForYear(rule, year);
      if (!resolvedRule) continue;

      const existing = ruleMap.get(resolvedRule.resolved_date_key);
      if (!existing) {
        ruleMap.set(resolvedRule.resolved_date_key, resolvedRule);
        continue;
      }

      if (resolvedRule.priority > existing.priority || (
        resolvedRule.priority === existing.priority && resolvedRule.multiplier > existing.multiplier
      )) {
        ruleMap.set(resolvedRule.resolved_date_key, resolvedRule);
      }
    }
  }

  return ruleMap;
};

const buildHolidayInfoFromRule = (rule, departureDate) => ({
  id: rule.id,
  rule_id: rule.id,
  name: rule.name,
  multiplier: parseFloat(rule.multiplier),
  reason: rule.reason,
  priority: Number(rule.priority || 0),
  calendar_type: rule.calendar_type,
  rule_type: rule.rule_type,
  offset_days: Number(rule.offset_days || 0),
  group_key: rule.group_key,
  date: rule.resolved_date,
  year: rule.resolved_year,
  is_resolved_from_rule: true,
  isHoliday: true,
  type: 'holiday',
  daysUntil: daysUntil(departureDate),
});

const getSeasonWindowForReferenceYear = (season, referenceYear) => {
  const start = createSeasonBoundaryDate(referenceYear, season.start_month, season.start_day);
  const crossesYear = season.start_month > season.end_month || (
    season.start_month === season.end_month && season.start_day > season.end_day
  );
  const endYear = crossesYear ? referenceYear + 1 : referenceYear;
  const end = createSeasonBoundaryDate(endYear, season.end_month, season.end_day || 28);

  return {
    start,
    end,
    crossesYear,
  };
};

const getSeasonWindowsForDate = (season, date) => {
  const { year } = getDateParts(date);
  return [
    getSeasonWindowForReferenceYear(season, year - 1),
    getSeasonWindowForReferenceYear(season, year),
  ];
};

const getUpcomingSeasonStart = (season, fromDate) => {
  const now = normalizeDate(fromDate);

  return [
    getSeasonWindowForReferenceYear(season, now.getFullYear() - 1),
    getSeasonWindowForReferenceYear(season, now.getFullYear()),
    getSeasonWindowForReferenceYear(season, now.getFullYear() + 1),
  ]
    .map(window => window.start)
    .filter(start => start >= now)
    .sort((a, b) => a - b)[0] || null;
};

// Lấy tất cả season periods đang active (có cache)
async function getActiveSeasons() {
  const now = Date.now();

  if (seasonCache && (now - seasonCacheTime) < CACHE_TTL_MS) {
    return seasonCache;
  }

  const result = await pool.query(`
    SELECT * FROM season_periods 
    WHERE is_active = true 
    ORDER BY priority DESC
  `);

  seasonCache = result.rows;
  seasonCacheTime = now;

  return seasonCache;
}

// Lấy tất cả holidays đang active (có cache)
async function getActiveHolidays() {
  const now = Date.now();

  if (holidayCache && (now - holidayCacheTime) < CACHE_TTL_MS) {
    return holidayCache;
  }

  const result = await pool.query(`
    SELECT * FROM holidays 
    WHERE is_active = true 
    ORDER BY date ASC
  `);

  holidayCache = result.rows;
  holidayCacheTime = now;

  return holidayCache;
}

async function getActiveHolidayRules() {
  const now = Date.now();

  if (holidayRuleCache && (now - holidayRuleCacheTime) < CACHE_TTL_MS) {
    return holidayRuleCache;
  }

  const result = await pool.query(`
    SELECT * FROM holiday_rules
    WHERE is_active = true
    ORDER BY priority DESC, name ASC
  `);

  holidayRuleCache = result.rows;
  holidayRuleCacheTime = now;

  return holidayRuleCache;
}

async function getResolvedHolidayRuleMap(targetDate) {
  const rules = await getActiveHolidayRules();
  const { year } = getDateParts(targetDate);
  return buildResolvedHolidayRuleMap(rules, [year - 1, year, year + 1]);
}

// Kiểm tra xem một date có nằm trong season period không
function isDateInSeason(date, season) {
  const target = normalizeDate(date);

  return getSeasonWindowsForDate(season, target).some(({ start, end }) => {
    const normalizedStart = normalizeDate(start);
    const normalizedEnd = normalizeDate(end);
    return target >= normalizedStart && target <= normalizedEnd;
  });
}

// Kiểm tra xem một date có phải là ngày lễ không
function isHoliday(date, holidays) {
  const d = new Date(date);
  const month = d.getMonth() + 1;
  const day = d.getDate();
  const year = d.getFullYear();

  for (const holiday of holidays) {
    const holidayDate = new Date(holiday.date);
    const holidayMonth = holidayDate.getMonth() + 1;
    const holidayDay = holidayDate.getDate();

    if (holiday.year) {
      if (month === holidayMonth && day === holidayDay && year === holiday.year) {
        return holiday;
      }
    } else if (month === holidayMonth && day === holidayDay) {
      return holiday;
    }
  }

  return null;
}

function getHolidayFromRule(date, resolvedRuleMap) {
  const targetKey = toDateKey(date);
  const resolvedRule = resolvedRuleMap.get(targetKey);
  if (!resolvedRule) return null;
  return buildHolidayInfoFromRule(resolvedRule, date);
}

// Tính số ngày từ date hiện tại đến target date
function daysUntil(targetDate) {
  const now = normalizeDate(new Date());
  const target = normalizeDate(targetDate);
  return Math.round((target - now) / (1000 * 60 * 60 * 24));
}

async function isApproachingPeakSeason(departureDate, thresholdDays = 30) {
  const seasons = await getActiveSeasons();
  const departure = normalizeDate(departureDate);

  for (const season of seasons) {
    if (isDateInSeason(departure, season)) {
      return {
        isApproaching: true,
        isInside: true,
        season,
        daysUntilSeasonStart: 0,
        reason: `đang trong ${season.name}`,
      };
    }

    const upcomingStart = getUpcomingSeasonStart(season, new Date());
    if (!upcomingStart) continue;

    const daysUntilSeason = daysUntil(upcomingStart);
    const departureDiff = Math.round((departure - upcomingStart) / (1000 * 60 * 60 * 24));

    if (daysUntilSeason >= 0 && daysUntilSeason <= thresholdDays && departureDiff >= 0) {
      return {
        isApproaching: true,
        isInside: false,
        season,
        daysUntilSeasonStart: daysUntilSeason,
        reason: `sắp vào ${season.name}`,
      };
    }
  }

  return {
    isApproaching: false,
    isInside: false,
    season: null,
    daysUntilSeasonStart: null,
    reason: null,
  };
}

async function getOverrideForDate(date) {
  const d = new Date(date);
  const dateStr = d.toISOString().split('T')[0];
  const cached = overrideCache.get(dateStr);
  const now = Date.now();

  if (cached && (now - cached.cachedAt) < OVERRIDE_CACHE_TTL_MS) {
    return cached.value;
  }

  const result = await pool.query(
    `SELECT * FROM price_overrides WHERE date = $1 AND is_active = true`,
    [dateStr]
  );

  const override = result.rows[0] || null;
  overrideCache.set(dateStr, {
    value: override,
    cachedAt: now,
  });

  return override;
}

function clearOverrideCache() {
  overrideCache.clear();
}

async function refreshCache() {
  seasonCache = null;
  seasonCacheTime = 0;
  holidayCache = null;
  holidayCacheTime = 0;
  holidayRuleCache = null;
  holidayRuleCacheTime = 0;
  overrideCache.clear();
  return getSeasonInfo(new Date().toISOString());
}

async function getSeasonInfo(departureDate) {
  try {
    const [override, seasons, holidays, resolvedHolidayRules] = await Promise.all([
      getOverrideForDate(departureDate),
      getActiveSeasons(),
      getActiveHolidays(),
      getResolvedHolidayRuleMap(departureDate),
    ]);

    if (override) {
      return {
        isPeak: parseFloat(override.multiplier) >= 1.20,
        isOverride: true,
        isHoliday: false,
        name: override.reason || 'Admin Override',
        multiplier: parseFloat(override.multiplier),
        reason: override.reason || 'Điều chỉnh giá thủ công',
        type: 'override',
        daysUntil: daysUntil(departureDate),
      };
    }

    const ruleHoliday = getHolidayFromRule(departureDate, resolvedHolidayRules);
    if (ruleHoliday) {
      return {
        isPeak: true,
        isHoliday: true,
        name: ruleHoliday.name,
        multiplier: parseFloat(ruleHoliday.multiplier),
        reason: ruleHoliday.reason,
        type: 'holiday',
        daysUntil: ruleHoliday.daysUntil,
        calendar_type: ruleHoliday.calendar_type,
        rule_type: ruleHoliday.rule_type,
        group_key: ruleHoliday.group_key,
      };
    }

    const holiday = isHoliday(departureDate, holidays);
    if (holiday) {
      return {
        isPeak: true,
        isHoliday: true,
        name: holiday.name,
        multiplier: parseFloat(holiday.multiplier),
        reason: holiday.reason,
        type: 'holiday',
        daysUntil: daysUntil(departureDate),
      };
    }

    let matchedSeason = null;
    let matchedMultiplier = 0;

    for (const season of seasons) {
      if (!isDateInSeason(departureDate, season)) continue;

      const multiplier = parseFloat(season.multiplier);
      if (!matchedSeason) {
        matchedSeason = season;
        matchedMultiplier = multiplier;
        continue;
      }

      const currentPriority = Number(season.priority || 0);
      const matchedPriority = Number(matchedSeason.priority || 0);
      if (currentPriority > matchedPriority || (currentPriority === matchedPriority && multiplier > matchedMultiplier)) {
        matchedSeason = season;
        matchedMultiplier = multiplier;
      }
    }

    if (matchedSeason) {
      const approaching = await isApproachingPeakSeason(departureDate);

      return {
        isPeak: matchedMultiplier >= 1.20,
        isApproaching: approaching.isApproaching && !approaching.isInside,
        isInside: approaching.isInside,
        name: matchedSeason.name,
        multiplier: matchedMultiplier,
        reason: matchedSeason.reason,
        type: 'season',
        daysUntil: daysUntil(departureDate),
        approachingInfo: approaching,
      };
    }

    return null;
  } catch (error) {
    console.error('[SeasonService] Error getting season info:', error);
    return null;
  }
}

async function getSeasonMultiplier(departureDate) {
  const info = await getSeasonInfo(departureDate);
  return info ? info.multiplier : 1.0;
}

async function shouldAlert(departureDate) {
  const info = await getSeasonInfo(departureDate);

  if (!info) return false;

  return info.isHoliday ||
         info.isPeak ||
         (info.isApproaching && info.multiplier >= 1.15);
}

async function getAllSeasonsAndHolidays() {
  const [seasons, holidays, holidayRules] = await Promise.all([
    pool.query('SELECT * FROM season_periods ORDER BY priority DESC, name ASC'),
    pool.query('SELECT * FROM holidays ORDER BY date ASC'),
    pool.query('SELECT * FROM holiday_rules ORDER BY priority DESC, name ASC'),
  ]);

  return {
    seasons: seasons.rows,
    holidays: holidays.rows,
    holidayRules: holidayRules.rows,
  };
}

module.exports = {
  getSeasonInfo,
  getSeasonMultiplier,
  shouldAlert,
  isApproachingPeakSeason,
  refreshCache,
  clearOverrideCache,
  getActiveSeasons,
  getActiveHolidays,
  getActiveHolidayRules,
  getAllSeasonsAndHolidays,
  getOverrideForDate,
  isDateInSeason,
  isHoliday,
  getHolidayFromRule,
  resolveHolidayRuleForYear,
  buildResolvedHolidayRuleMap,
  daysUntil,
};
