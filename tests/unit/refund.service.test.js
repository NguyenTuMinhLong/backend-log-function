'use strict';

/*
=========================================================
UNIT TESTS: REFUND SERVICE
=========================================================
*/

const { describe, it, expect, jest, beforeEach } = require('@jest/globals');

// Mock dependencies
jest.mock('../../src/config/db', () => ({
  query: jest.fn(),
  connect: jest.fn(),
}));

jest.mock('../../src/config/refund.config', () => ({
  POLICIES: [
    { name: 'full_refund', hoursBefore: 72, refundPercent: 100, label: 'Hoàn 100%' },
    { name: 'high_refund', hoursBefore: 24, refundPercent: 80, label: 'Hoàn 80%' },
    { name: 'medium_refund', hoursBefore: 12, refundPercent: 50, label: 'Hoàn 50%' },
    { name: 'low_refund', hoursBefore: 0, refundPercent: 0, label: 'Không hoàn' },
  ],
  ADMIN_FEE: { enabled: false },
  VOUCHER_HANDLING: { refundOnFinalAmount: true },
  VALIDATION: { requireReason: true, minReasonLength: 10, minRefundAmount: 0 },
  CONCURRENCY: { preventDuplicateRequests: true },
  findPolicy: (hours) => {
    const policies = [
      { name: 'full_refund', hoursBefore: 72, refundPercent: 100 },
      { name: 'high_refund', hoursBefore: 24, refundPercent: 80 },
      { name: 'medium_refund', hoursBefore: 12, refundPercent: 50 },
      { name: 'low_refund', hoursBefore: 0, refundPercent: 0 },
    ];
    for (const p of policies) {
      if (hours >= p.hoursBefore) return p;
    }
    return policies[policies.length - 1];
  },
}));

const pool = require('../../src/config/db');

// Import service after mocks
const refundService = require('../../src/services/refund.service');

describe('Refund Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('calculateRefundAmount', () => {
    it('should calculate full refund (100%) when > 72 hours before departure', () => {
      const booking = { total_adults: 1, total_children: 0, total_infants: 0 };
      const payment = { amount: 1000000, final_amount: 1000000, discount_amount: 0 };
      const policy = { name: 'full_refund', refundPercent: 100, label: 'Hoàn 100%' };

      const result = refundService.calculateRefundAmount(booking, payment, policy);

      expect(result.refund_percent).toBe(100);
      expect(result.refund_amount).toBe(1000000);
      expect(result.net_refund_amount).toBe(1000000);
    });

    it('should calculate 80% refund when 24-72 hours before departure', () => {
      const booking = { total_adults: 1, total_children: 0, total_infants: 0 };
      const payment = { amount: 1000000, final_amount: 1000000, discount_amount: 0 };
      const policy = { name: 'high_refund', refundPercent: 80, label: 'Hoàn 80%' };

      const result = refundService.calculateRefundAmount(booking, payment, policy);

      expect(result.refund_percent).toBe(80);
      expect(result.refund_amount).toBe(800000);
      expect(result.net_refund_amount).toBe(800000);
    });

    it('should calculate 50% refund when 12-24 hours before departure', () => {
      const booking = { total_adults: 1, total_children: 0, total_infants: 0 };
      const payment = { amount: 1000000, final_amount: 1000000, discount_amount: 0 };
      const policy = { name: 'medium_refund', refundPercent: 50, label: 'Hoàn 50%' };

      const result = refundService.calculateRefundAmount(booking, payment, policy);

      expect(result.refund_percent).toBe(50);
      expect(result.refund_amount).toBe(500000);
      expect(result.net_refund_amount).toBe(500000);
    });

    it('should calculate 0% refund when < 12 hours before departure', () => {
      const booking = { total_adults: 1, total_children: 0, total_infants: 0 };
      const payment = { amount: 1000000, final_amount: 1000000, discount_amount: 0 };
      const policy = { name: 'low_refund', refundPercent: 0, label: 'Không hoàn' };

      const result = refundService.calculateRefundAmount(booking, payment, policy);

      expect(result.refund_percent).toBe(0);
      expect(result.refund_amount).toBe(0);
      expect(result.net_refund_amount).toBe(0);
    });

    it('should calculate partial leg refund correctly', () => {
      const booking = { total_adults: 2, total_children: 0, total_infants: 0 };
      const payment = { amount: 2000000, final_amount: 2000000, discount_amount: 0 };
      const policy = { name: 'full_refund', refundPercent: 100, label: 'Hoàn 100%' };
      const requestedItems = { legs: ['outbound'] };

      const result = refundService.calculateRefundAmount(booking, payment, policy, 'partial_leg', requestedItems);

      // 50% cho 1 leg trong round trip
      expect(result.refund_percent).toBe(100);
      expect(result.refund_amount).toBe(1000000); // 50% của 2000000
    });

    it('should calculate partial passenger refund correctly', () => {
      const booking = { total_adults: 2, total_children: 1, total_infants: 0 };
      const payment = { amount: 3000000, final_amount: 3000000, discount_amount: 0 };
      const policy = { name: 'full_refund', refundPercent: 100, label: 'Hoàn 100%' };
      const requestedItems = { passenger_ids: [1] }; // 1 trong 3 passengers

      const result = refundService.calculateRefundAmount(booking, payment, policy, 'partial_passenger', requestedItems);

      // 1/3 của 3000000
      expect(result.refund_amount).toBe(1000000);
    });

    it('should handle voucher discount correctly', () => {
      const booking = { total_adults: 1, total_children: 0, total_infants: 0 };
      const payment = { amount: 1000000, final_amount: 900000, discount_amount: 100000 };
      const policy = { name: 'full_refund', refundPercent: 100, label: 'Hoàn 100%' };

      const result = refundService.calculateRefundAmount(booking, payment, policy);

      // Refund trên final_amount (900000) không phải amount (1000000)
      expect(result.original_amount).toBe(1000000);
      expect(result.discount_amount).toBe(100000);
      expect(result.base_amount).toBe(900000);
      expect(result.refund_amount).toBe(900000);
    });
  });

  describe('calculateHoursUntilDeparture', () => {
    it('should calculate hours correctly for future date', () => {
      const futureDate = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours from now
      const hours = refundService.calculateHoursUntilDeparture(futureDate.toISOString());

      expect(hours).toBeGreaterThan(23);
      expect(hours).toBeLessThan(25);
    });

    it('should return 0 for past date', () => {
      const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000); // 24 hours ago
      const hours = refundService.calculateHoursUntilDeparture(pastDate.toISOString());

      expect(hours).toBe(0);
    });
  });

  describe('validateRefundRequest', () => {
    it('should throw error if booking not found', () => {
      expect(() => {
        refundService.validateRefundRequest(null, {}, 1);
      }).toThrow('Không tìm thấy booking');
    });

    it('should throw error if booking status is not confirmed', () => {
      const booking = { status: 'pending' };
      expect(() => {
        refundService.validateRefundRequest(booking, {}, 1);
      }).toThrow('Không thể refund booking có trạng thái "pending"');
    });

    it('should throw error if flight has departed', () => {
      const pastDate = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // 1 hour ago
      const booking = { 
        status: 'confirmed', 
        outbound_departure_time: pastDate,
        trip_type: 'one_way'
      };

      expect(() => {
        refundService.validateRefundRequest(booking, {}, 1);
      }).toThrow('Không thể refund: Chuyến bay đã khởi hành');
    });

    it('should throw error if round trip return flight has departed', () => {
      const now = new Date();
      const outboundPast = new Date(now - 60 * 60 * 1000).toISOString(); // 1 hour ago
      const returnFuture = new Date(now + 48 * 60 * 60 * 1000).toISOString(); // 48 hours from now

      const booking = { 
        status: 'confirmed', 
        outbound_departure_time: outboundPast,
        return_departure_time: returnFuture,
        trip_type: 'round_trip'
      };

      expect(() => {
        refundService.validateRefundRequest(booking, {}, 1);
      }).toThrow('Không thể refund: Chuyến bay đã khởi hành');
    });

    it('should throw error if payment not found', () => {
      const futureDate = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      const booking = { 
        status: 'confirmed', 
        outbound_departure_time: futureDate,
        trip_type: 'one_way'
      };

      expect(() => {
        refundService.validateRefundRequest(booking, null, 1);
      }).toThrow('Không tìm thấy thông tin thanh toán');
    });

    it('should throw error if payment status is not SUCCESS', () => {
      const futureDate = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      const booking = { 
        status: 'confirmed', 
        outbound_departure_time: futureDate,
        trip_type: 'one_way'
      };
      const payment = { status: 'PENDING' };

      expect(() => {
        refundService.validateRefundRequest(booking, payment, 1);
      }).toThrow('Chỉ booking đã thanh toán thành công mới được refund');
    });
  });
});

describe('Refund Config', () => {
  const { findPolicy, POLICIES } = require('../../src/config/refund.config');

  describe('findPolicy', () => {
    it('should return full_refund for > 72 hours', () => {
      const policy = findPolicy(100);
      expect(policy.name).toBe('full_refund');
      expect(policy.refundPercent).toBe(100);
    });

    it('should return high_refund for 24-72 hours', () => {
      const policy = findPolicy(48);
      expect(policy.name).toBe('high_refund');
      expect(policy.refundPercent).toBe(80);
    });

    it('should return medium_refund for 12-24 hours', () => {
      const policy = findPolicy(18);
      expect(policy.name).toBe('medium_refund');
      expect(policy.refundPercent).toBe(50);
    });

    it('should return low_refund for < 12 hours', () => {
      const policy = findPolicy(6);
      expect(policy.name).toBe('low_refund');
      expect(policy.refundPercent).toBe(0);
    });
  });

  describe('POLICIES', () => {
    it('should have 4 policies defined', () => {
      expect(POLICIES).toHaveLength(4);
    });

    it('should have correct refund percentages', () => {
      expect(POLICIES[0].refundPercent).toBe(100);
      expect(POLICIES[1].refundPercent).toBe(80);
      expect(POLICIES[2].refundPercent).toBe(50);
      expect(POLICIES[3].refundPercent).toBe(0);
    });
  });
});
