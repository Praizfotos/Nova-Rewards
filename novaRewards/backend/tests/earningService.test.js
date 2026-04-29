const {
  calculatePointsEarned,
  recordPointEarning,
  getUserEarningHistory,
  getUserEarningStats,
} = require('../../services/earningService');
const { recordPointTransaction } = require('../../db/pointTransactionRepository');

describe('Earning Service', () => {
  describe('calculatePointsEarned', () => {
    it('should calculate base points correctly', async () => {
      const amount = 100;
      const rate = 1.5;
      const userId = 1;
      
      const points = await calculatePointsEarned(amount, rate, userId);
      expect(points).toBe(150);
    });

    it('should round decimal points to nearest integer', async () => {
      const amount = 33.33;
      const rate = 1.5;
      const userId = 1;
      
      const points = await calculatePointsEarned(amount, rate, userId);
      expect(typeof points).toBe('number');
      expect(Number.isInteger(points)).toBe(true);
    });

    it('should throw error for invalid amount', async () => {
      try {
        await calculatePointsEarned(0, 1.5, 1);
        fail('Should have thrown error');
      } catch (err) {
        expect(err.message).toContain('positive');
      }
    });

    it('should throw error for invalid rate', async () => {
      try {
        await calculatePointsEarned(100, -1, 1);
        fail('Should have thrown error');
      } catch (err) {
        expect(err.message).toContain('positive');
      }
    });
  });

  describe('recordPointEarning', () => {
    it('should record a valid earning transaction', async () => {
      const mockData = {
        userId: 1,
        transactionAmount: 100,
        campaignId: 1,
        campaignRewardRate: 1.5,
        transactionId: 'tx123',
      };

      const result = await recordPointEarning(mockData);
      
      expect(result.success).toBe(true);
      expect(result.pointsEarned).toBeGreaterThan(0);
      expect(result.expirationDays).toBeGreaterThan(0);
      expect(result.pointTransaction).toBeDefined();
    });

    it('should apply tier multiplier if user has tier', async () => {
      // This test assumes the user has a tier set up
      const mockData = {
        userId: 2,
        transactionAmount: 100,
        campaignId: 1,
        campaignRewardRate: 1.0,
        transactionId: 'tx124',
      };

      const result = await recordPointEarning(mockData);
      
      expect(result.success).toBe(true);
      expect(result.tierUpdate).toBeDefined();
    });

    it('should set expiration date correctly', async () => {
      const mockData = {
        userId: 1,
        transactionAmount: 100,
        campaignId: 1,
        campaignRewardRate: 1.5,
        transactionId: 'tx125',
      };

      const result = await recordPointEarning(mockData);
      
      expect(result.pointTransaction.expires_at).toBeDefined();
      const expiryDate = new Date(result.pointTransaction.expires_at);
      const today = new Date();
      const daysDifference = Math.floor((expiryDate - today) / (1000 * 60 * 60 * 24));
      
      expect(daysDifference).toBeLessThanOrEqual(result.expirationDays);
      expect(daysDifference).toBeGreaterThanOrEqual(result.expirationDays - 1);
    });
  });

  describe('getUserEarningHistory', () => {
    it('should return earning history for user', async () => {
      const userId = 1;
      
      const history = await getUserEarningHistory(userId, 10);
      
      expect(Array.isArray(history)).toBe(true);
      history.forEach(tx => {
        expect(tx.type).toMatch(/earned|bonus|referral/);
      });
    });

    it('should respect limit parameter', async () => {
      const userId = 1;
      const limit = 5;
      
      const history = await getUserEarningHistory(userId, limit);
      
      expect(history.length).toBeLessThanOrEqual(limit);
    });
  });

  describe('getUserEarningStats', () => {
    it('should calculate earning statistics', async () => {
      const userId = 1;
      
      const stats = await getUserEarningStats(userId);
      
      expect(stats.total).toBeGreaterThanOrEqual(0);
      expect(stats.earned).toBeGreaterThanOrEqual(0);
      expect(stats.bonus).toBeGreaterThanOrEqual(0);
      expect(stats.referral).toBeGreaterThanOrEqual(0);
      expect(stats.transactionCounts).toBeDefined();
    });

    it('should have non-negative values', async () => {
      const userId = 1;
      
      const stats = await getUserEarningStats(userId);
      
      expect(stats.total).toBeGreaterThanOrEqual(0);
      expect(stats.earned).toBeGreaterThanOrEqual(0);
      expect(stats.bonus).toBeGreaterThanOrEqual(0);
      expect(stats.referral).toBeGreaterThanOrEqual(0);
    });
  });
});
