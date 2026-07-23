'use strict';

const seasonService = require('../services/season.service');

// Day-of-week multiplier
const getDayOfWeekMult = (depTime) => {
  const day = new Date(depTime).getDay();
  if (day === 0) return 1.20;
  if (day === 5) return 1.15;
  if (day === 6) return 1.10;
  return 1.00;
};

// Advance booking multiplier
const getAdvanceMult = (depTime) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffDays = Math.round((new Date(depTime) - today) / 86400000);
  if (diffDays <= 2)  return 1.45;
  if (diffDays <= 5)  return 1.30;
  if (diffDays <= 10) return 1.15;
  if (diffDays <= 20) return 1.05;
  if (diffDays <= 35) return 1.00;
  if (diffDays <= 50) return 0.93;
  return 0.87;
};

// Demand multiplier
const getDemandMult = (availableSeats, totalSeats) => {
  const avail = parseInt(availableSeats) || 0;
  const total = parseInt(totalSeats) || 1;
  const occupancy = Math.max(0, Math.min(1, (total - avail) / total));
  if (occupancy >= 0.90) return 1.40;
  if (occupancy >= 0.75) return 1.25;
  if (occupancy >= 0.60) return 1.15;
  if (occupancy >= 0.40) return 1.05;
  if (occupancy >= 0.20) return 1.00;
  return 0.97;
};

const applyDynamicPricing = (basePrice, availableSeats, totalSeats, depTime, seasonMultiplier = 1.0) => {
  const mult = getDayOfWeekMult(depTime) * getAdvanceMult(depTime) * getDemandMult(availableSeats, totalSeats) * seasonMultiplier;
  return Math.round(basePrice * mult / 1000) * 1000;
};

// Async version that fetches season multiplier automatically
const applyDynamicPricingWithSeason = async (basePrice, availableSeats, totalSeats, depTime) => {
  const seasonMultiplier = await seasonService.getSeasonMultiplier(depTime);
  return applyDynamicPricing(basePrice, availableSeats, totalSeats, depTime, seasonMultiplier);
};

module.exports = {
  getDayOfWeekMult,
  getAdvanceMult,
  getDemandMult,
  applyDynamicPricing,
  applyDynamicPricingWithSeason,
  seasonService,
};
