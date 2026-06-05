'use strict';

const pool = require('../config/db');

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

// Cache để tránh query DB quá nhiều (invalid sau 1 giờ)
let seasonCache = null;
let seasonCacheTime = 0;
let holidayCache = null;
let holidayCacheTime = 0;
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

const compareMonthDay = (leftMonth, leftDay, rightMonth, rightDay) => {
  if (leftMonth !== rightMonth) {
    return leftMonth - rightMonth;
  }
  return leftDay - rightDay;
};

const createSeasonBoundaryDate = (year, month, day) => {
  return new Date(year, month - 1, day || 1);
};

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
  const now = new Date(fromDate);
  now.setHours(0, 0, 0, 0);

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

// Kiểm tra xem một date có nằm trong season period không
// @param {Date|string} date - Date cần check
// @param {object} season - Season period từ DB
// @returns {boolean}
function isDateInSeason(date, season) {
  const target = new Date(date);
  target.setHours(0, 0, 0, 0);

  return getSeasonWindowsForDate(season, target).some(({ start, end }) => {
    const normalizedStart = new Date(start);
    const normalizedEnd = new Date(end);
    normalizedStart.setHours(0, 0, 0, 0);
    normalizedEnd.setHours(0, 0, 0, 0);
    return target >= normalizedStart && target <= normalizedEnd;
  });
}

// Kiểm tra xem một date có phải là ngày lễ không
// @param {Date|string} date - Date cần check
// @param {Array} holidays - Danh sách holidays từ DB
// @returns {object|null} - Holiday info hoặc null
function isHoliday(date, holidays) {
  const d = new Date(date);
  const month = d.getMonth() + 1;
  const day = d.getDate();
  const year = d.getFullYear();
  
  for (const holiday of holidays) {
    const holidayDate = new Date(holiday.date);
    const holidayMonth = holidayDate.getMonth() + 1;
    const holidayDay = holidayDate.getDate();
    const holidayYear = holidayDate.getFullYear();
    
    // Check exact match (date có year)
    if (holiday.year) {
      if (month === holidayMonth && day === holidayDay && year === holiday.year) {
        return holiday;
      }
    } else {
      // Check reusable holiday (year = NULL, lặp lại hàng năm)
      if (month === holidayMonth && day === holidayDay) {
        return holiday;
      }
    }
  }
  
  return null;
}

// Tính số ngày từ date hiện tại đến target date
// @param {Date|string} targetDate - Ngày target
// @returns {number} - Số ngày (âm nếu đã qua)
function daysUntil(targetDate) {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const target = new Date(targetDate);
  target.setHours(0, 0, 0, 0);
  return Math.round((target - now) / (1000 * 60 * 60 * 24));
}

// Kiểm tra date có đang TIẾN VÀO mùa cao điểm không
// @param {Date|string} departureDate - Ngày khởi hành
// @param {number} thresholdDays - Số ngày threshold (mặc định 30)
// @returns {object} - { isApproaching: boolean, season: object|null, daysUntilSeasonStart: number }
async function isApproachingPeakSeason(departureDate, thresholdDays = 30) {
  const seasons = await getActiveSeasons();
  const departure = new Date(departureDate);
  departure.setHours(0, 0, 0, 0);

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
    reason: null
  };
}

// Lấy override cho một ngày cụ thể (có cache)
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

// Xóa cache override (gọi khi admin CRUD overrides)
function clearOverrideCache() {
  overrideCache.clear();
}

// Xóa cache hoàn toàn (gọi khi admin thay đổi season/holiday config)
async function refreshCache() {
  seasonCache = null;
  seasonCacheTime = 0;
  holidayCache = null;
  holidayCacheTime = 0;
  overrideCache.clear();
  return getSeasonInfo(new Date().toISOString());
}

/*============================================================
MAIN FUNCTION: getSeasonInfo
Trả về thông tin mùa cao điểm cho một departure date
Priority: Override > Holiday > Season > null

Ví dụ:
  const info = await getSeasonInfo('2026-06-15');
  // Returns: { isPeak: true, name: 'Mùa hè', multiplier: 1.30, reason: 'học sinh nghỉ hè' }
============================================================*/
// @param {Date|string} departureDate - Ngày khởi hành
// @returns {Promise<object|null>} - Season info hoặc null nếu off-peak
async function getSeasonInfo(departureDate) {
  try {
    const [override, seasons, holidays] = await Promise.all([
      getOverrideForDate(departureDate),
      getActiveSeasons(),
      getActiveHolidays()
    ]);
    
    // 0. Check Override trước (admin custom - priority cao nhất)
    if (override) {
      return {
        isPeak: parseFloat(override.multiplier) >= 1.20,
        isOverride: true,
        isHoliday: false,
        name: override.reason || 'Admin Override',
        multiplier: parseFloat(override.multiplier),
        reason: override.reason || 'Điều chỉnh giá thủ công',
        type: 'override',
        daysUntil: daysUntil(departureDate)
      };
    }
    
    // 1. Check nếu là ngày lễ
    const holiday = isHoliday(departureDate, holidays);
    if (holiday) {
      return {
        isPeak: true,
        isHoliday: true,
        name: holiday.name,
        multiplier: parseFloat(holiday.multiplier),
        reason: holiday.reason,
        type: 'holiday',
        daysUntil: daysUntil(departureDate)
      };
    }
    
    // 2. Check mùa cao điểm (ưu tiên theo priority DESC, fallback multiplier cao hơn)
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
        approachingInfo: approaching
      };
    }
    
    // 3. Off-peak - không có season/holiday
    return null;
    
  } catch (error) {
    console.error('[SeasonService] Error getting season info:', error);
    return null;
  }
}

/*============================================================
HELPER: Tính season multiplier cho pricing
@param {Date|string} departureDate - Ngày khởi hành
@returns {Promise<number>} - Multiplier (1.0 = off-peak)
============================================================*/
async function getSeasonMultiplier(departureDate) {
  const info = await getSeasonInfo(departureDate);
  return info ? info.multiplier : 1.0;
}

/*============================================================
HELPER: Kiểm tra nhanh - có nên alert không
Chỉ return true khi CÓ mùa cao điểm/ngày lễ VÀ đang tiến vào peak
@param {Date|string} departureDate - Ngày khởi hành
@returns {Promise<boolean>}
============================================================*/
async function shouldAlert(departureDate) {
  const info = await getSeasonInfo(departureDate);
  
  if (!info) return false;
  
  // Alert khi:
  // 1. Là ngày lễ
  // 2. Đang ở trong mùa cao điểm (multiplier >= 1.20)
  // 3. Đang tiến vào mùa cao điểm (approaching)
  
  return info.isHoliday || 
         info.isPeak || 
         (info.isApproaching && info.multiplier >= 1.15);
}

/**
 * Lấy tất cả seasons và holidays cho admin dashboard
 */
async function getAllSeasonsAndHolidays() {
  const [seasons, holidays] = await Promise.all([
    pool.query('SELECT * FROM season_periods ORDER BY priority DESC, name ASC'),
    pool.query('SELECT * FROM holidays ORDER BY date ASC')
  ]);
  
  return {
    seasons: seasons.rows,
    holidays: holidays.rows
  };
}

module.exports = {
  // Main functions
  getSeasonInfo,
  getSeasonMultiplier,
  shouldAlert,
  isApproachingPeakSeason,
  
  // Cache management
  refreshCache,
  clearOverrideCache,
  
  // Admin functions
  getActiveSeasons,
  getActiveHolidays,
  getAllSeasonsAndHolidays,
  getOverrideForDate,
  
  // Helpers (exposed for testing)
  isDateInSeason,
  isHoliday,
  daysUntil
};
