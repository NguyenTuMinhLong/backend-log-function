'use strict';

const seasonService = require('./season.service');
const { 
  getDayOfWeekMult, 
  getAdvanceMult, 
  getDemandMult, 
  applyDynamicPricing 
} = require('../utils/pricing');

/*
============================================================
PRICE ALERT SERVICE - Engine phân tích & generate alert
============================================================

Chỉ generate alert khi giá TĂNG so với base price

Alert Levels:
- high:    > 20% increase
- medium:  10-20% increase
- low:     5-10% increase
- none:    ≤ 5% change
============================================================
*/

// Threshold để trigger alert (% change)
const ALERT_THRESHOLD_PERCENT = 5;

/**
 * Tính price breakdown chi tiết
 */
function calculatePriceBreakdown(basePrice, availableSeats, totalSeats, departureTime) {
  const dayOfWeekMult = getDayOfWeekMult(departureTime);
  const advanceMult = getAdvanceMult(departureTime);
  const demandMult = getDemandMult(availableSeats, totalSeats);
  
  return {
    basePrice,
    dayOfWeekMult,
    advanceMult,
    demandMult,
    totalMultiplier: dayOfWeekMult * advanceMult * demandMult,
    calculatedPrice: Math.round(basePrice * dayOfWeekMult * advanceMult * demandMult / 1000) * 1000
  };
}

// Xác định level dựa trên % change
function getAlertLevel(percentChange) {
  if (percentChange > 20) return 'high';
  if (percentChange > 10) return 'medium';
  if (percentChange > ALERT_THRESHOLD_PERCENT) return 'low';
  return 'none';
}

// Tạo message dựa trên level và season
function generateAlertMessage(level, percentChange, seasonInfo, pricingBreakdown) {
  const roundedPercent = Math.round(percentChange);
  
  // Base message
  let message = `Giá tăng ${roundedPercent}%`;
  
  if (seasonInfo) {
    message += ` do đang ${seasonInfo.reason}`;
  } else if (pricingBreakdown.demandMult > 1.20) {
    message += ` do nhu cầu cao`;
  } else if (pricingBreakdown.advanceMult > 1.20) {
    message += ` do đặt gần ngày`;
  }
  
  return message;
}

// Tạo recommendation dựa trên level
function generateRecommendation(level, seasonInfo) {
  const recommendations = {
    high: 'Nên đặt ngay, giá có thể tăng thêm trong 24h!',
    medium: 'Nên đặt sớm, giá có khả năng tăng trong 24h tới',
    low: 'Giá có xu hướng tăng nhẹ, có thể đặt sớm',
    none: null
  };
  
  // Custom message cho holiday
  if (seasonInfo?.isHoliday && level !== 'none') {
    return `Hôm nay là ngày lễ ${seasonInfo.name}. Nên đặt ngay!`;
  }
  
  return recommendations[level] || null;
}

/*
============================================================
MAIN FUNCTION: Generate price alert cho 1 flight
============================================================

Ví dụ:
  const alert = await generatePriceAlert(flight, '2026-06-15');
  // Returns: { type: 'PRICE_INCREASE', level: 'high', percentage: 30, message: '...' }
*/
 * 
 * @param {object} flight - Flight object từ DB
 * @param {Date|string} departureDate - Ngày khởi hành (optional, override flight.departure_time)
 * @param {Date|string} currentDate - Ngày hiện tại (optional, default: now)
 * 
 * @returns {Promise<object|null>} - Alert object hoặc null nếu không alert
 * 
 * @example
 * const alert = await generatePriceAlert(flight, '2026-06-15');
 * // Returns: { type: 'PRICE_INCREASE', level: 'high', percentage: 30, message: '...' }
 */
async function generatePriceAlert(flight, departureDate = null, currentDate = null) {
  try {
    // 1. Xác định departure date
    const depDate = departureDate || flight.departure_time || flight.departure_date;
    
    if (!depDate) {
      console.warn('[PriceAlertService] No departure date provided');
      return null;
    }
    
    // 2. Tính current price sử dụng pricing utils hiện tại
    const availableSeats = flight.available_seats ?? flight.seats_available ?? 0;
    const totalSeats = flight.total_seats ?? flight.seats_total ?? 1;
    const basePrice = flight.base_price || flight.price || 0;
    
    if (basePrice <= 0) {
      return null;
    }
    
    // 3. Tính price breakdown chi tiết
    const breakdown = calculatePriceBreakdown(basePrice, availableSeats, totalSeats, depDate);
    
    // 4. Tính % change so với base price
    const currentPrice = breakdown.calculatedPrice;
    const percentChange = ((currentPrice - basePrice) / basePrice) * 100;
    
    // 5. Lấy season info
    const seasonInfo = await seasonService.getSeasonInfo(depDate);
    
    // 6. CHỈ alert khi giá TĂNG > threshold
    if (percentChange <= ALERT_THRESHOLD_PERCENT) {
      return null; // Giá ổn định hoặc giảm → không alert
    }
    
    // 7. Xác định level
    const level = getAlertLevel(percentChange);
    
    // 8. Generate message và recommendation
    const message = generateAlertMessage(level, percentChange, seasonInfo, breakdown);
    const recommendation = generateRecommendation(level, seasonInfo);
    
    // 9. Build alert object
    const alert = {
      type: 'PRICE_INCREASE',
      level,
      percentage: Math.round(percentChange),
      basePrice,
      currentPrice,
      basePriceFormatted: formatCurrency(basePrice),
      currentPriceFormatted: formatCurrency(currentPrice),
      message,
      recommendation,
      seasonMultiplier: seasonInfo?.multiplier || 1.0,
      seasonName: seasonInfo?.name || null,
      seasonReason: seasonInfo?.reason || null,
      pricingFactors: {
        dayOfWeek: breakdown.dayOfWeekMult,
        advanceBooking: breakdown.advanceMult,
        demand: breakdown.demandMult,
        totalMultiplier: parseFloat(breakdown.totalMultiplier.toFixed(2))
      },
      generatedAt: new Date().toISOString()
    };
    
    return alert;
    
  } catch (error) {
    console.error('[PriceAlertService] Error generating price alert:', error);
    return null;
  }
}

/*
============================================================
BATCH FUNCTION: Generate alerts cho nhiều flights
============================================================
Dùng trong search results
*/
 * 
 * @param {Array} flights - Array of flight objects
 * @param {Date|string} currentDate - Ngày hiện tại (optional)
 * 
 * @returns {Promise<Array>} - Array of flights với price_alert field
 */
async function generatePriceAlertsForFlights(flights, currentDate = null) {
  if (!flights || flights.length === 0) {
    return [];
  }
  
  // Promise.all để query season info cho tất cả flights
  const alerts = await Promise.all(
    flights.map(flight => generatePriceAlert(flight, null, currentDate))
  );
  
  // Merge alerts vào flights
  return flights.map((flight, index) => ({
    ...flight,
    price_alert: alerts[index] // null nếu không có alert
  }));
}

/*
============================================================
ANALYSIS FUNCTION: Chi tiết phân tích giá
============================================================
Dùng cho detail page
*/
 * 
 * @param {object} flight - Flight object
 * @returns {Promise<object>}
 */
async function getDetailedAnalysis(flight) {
  const departureDate = flight.departure_time || flight.departure_date;
  
  // Get all data
  const [seasonInfo, priceAlert] = await Promise.all([
    seasonService.getSeasonInfo(departureDate),
    generatePriceAlert(flight)
  ]);
  
  // Calculate base breakdown
  const availableSeats = flight.available_seats ?? flight.seats_available ?? 0;
  const totalSeats = flight.total_seats ?? flight.seats_total ?? 1;
  const basePrice = flight.base_price || flight.price || 0;
  
  const breakdown = calculatePriceBreakdown(basePrice, availableSeats, totalSeats, departureDate);
  
  return {
    flightId: flight.id,
    departureDate,
    basePrice,
    currentPrice: breakdown.calculatedPrice,
    percentChange: priceAlert?.percentage || 0,
    
    season: seasonInfo ? {
      name: seasonInfo.name,
      multiplier: seasonInfo.multiplier,
      reason: seasonInfo.reason,
      isHoliday: seasonInfo.isHoliday || false,
      isPeak: seasonInfo.isPeak || false
    } : null,
    
    pricingBreakdown: {
      basePrice,
      dayOfWeek: {
        multiplier: breakdown.dayOfWeekMult,
        label: getDayOfWeekLabel(departureDate)
      },
      advanceBooking: {
        multiplier: breakdown.advanceMult,
        daysUntilDeparture: getDaysUntilDeparture(departureDate)
      },
      demand: {
        multiplier: breakdown.demandMult,
        occupancyRate: totalSeats > 0 ? ((totalSeats - availableSeats) / totalSeats * 100).toFixed(0) + '%' : 'N/A'
      },
      finalMultiplier: parseFloat(breakdown.totalMultiplier.toFixed(2))
    },
    
    alert: priceAlert,
    
    recommendation: priceAlert ? {
      action: priceAlert.level === 'high' ? 'BUY_NOW' : 'BOOK_SOON',
      urgency: priceAlert.level,
      message: priceAlert.recommendation
    } : null
  };
}

// Helpers

function formatCurrency(amount) {
  if (!amount) return '0 VND';
  return new Intl.NumberFormat('vi-VN', {
    style: 'currency',
    currency: 'VND',
    maximumFractionDigits: 0
  }).format(amount);
}

function getDayOfWeekLabel(date) {
  const days = ['Chủ Nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];
  return days[new Date(date).getDay()];
}

function getDaysUntilDeparture(date) {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const dep = new Date(date);
  dep.setHours(0, 0, 0, 0);
  return Math.max(0, Math.round((dep - now) / (1000 * 60 * 60 * 24)));
}

module.exports = {
  // Main functions
  generatePriceAlert,
  generatePriceAlertsForFlights,
  getDetailedAnalysis,
  
  // Helpers
  calculatePriceBreakdown,
  getAlertLevel,
  formatCurrency,
  
  // Constants
  ALERT_THRESHOLD_PERCENT
};
