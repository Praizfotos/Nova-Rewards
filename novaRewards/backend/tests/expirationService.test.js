const {
  markExpiredPoints,
  getExpiringPointsWarning,
  getUserExpirationStats,
  getUserExpirationHistory,
  calculateActiveBalance,
  getExpirationTimeline,
} = require('../../services/expirationService');

describe('Expiration Service', () => {
  describe('markExpiredPoints', () => {
    it('should mark expired points', async () => {
      const result = await markExpiredPoints();
      
      expect(result.success).toBe(true);
      expect(result.expiredCount).toBeGreaterThanOrEqual(0);
      expect(result.pointsExpired).toBeGreaterThanOrEqual(0);
    });

    it('should return correct response structure', async () => {
      const result = await markExpiredPoints();
      
      expect(result.success).toBeDefined();
      expect(result.expiredCount).toBeDefined();
      expect(result.pointsExpired).toBeDefined();
      expect(result.message).toBeDefined();
    });
  });

  describe('getExpiringPointsWarning', () => {
    it('should identify points expiring soon', async () => {
      const userId = 1;
      
      const warning = await getExpiringPointsWarning(userId, 30);
      
      expect(warning.userId).toBe(userId);
      expect(warning.expiringPointsCount).toBeGreaterThanOrEqual(0);
      expect(warning.totalPointsAtRisk).toBeGreaterThanOrEqual(0);
      expect(Array.isArray(warning.expiredTransactions)).toBe(true);
    });

    it('should respect threshold parameter', async () => {
      const userId = 1;
      
      const warning7Days = await getExpiringPointsWarning(userId, 7);
      const warning30Days = await getExpiringPointsWarning(userId, 30);
      
      // 30 days threshold should find at least as many as 7 days
      expect(warning30Days.expiringPointsCount).toBeGreaterThanOrEqual(
        warning7Days.expiringPointsCount
      );
    });
  });

  describe('getUserExpirationStats', () => {
    it('should calculate expiration statistics', async () => {
      const userId = 1;
      
      const stats = await getUserExpirationStats(userId);
      
      expect(stats.userId).toBe(userId);
      expect(stats.expiredPoints).toBeGreaterThanOrEqual(0);
      expect(stats.activePoints).toBeGreaterThanOrEqual(0);
      expect(stats.expiredTransactionCount).toBeGreaterThanOrEqual(0);
      expect(stats.activeTransactionCount).toBeGreaterThanOrEqual(0);
    });

    it('should show next expiry date', async () => {
      const userId = 1;
      
      const stats = await getUserExpirationStats(userId);
      
      if (stats.activeTransactionCount > 0) {
        expect(stats.nextExpiryDate).toBeDefined();
      }
    });
  });

  describe('getUserExpirationHistory', () => {
    it('should retrieve expired points history', async () => {
      const userId = 1;
      
      const history = await getUserExpirationHistory(userId, 10);
      
      expect(Array.isArray(history)).toBe(true);
      history.forEach(tx => {
        expect(tx.id).toBeDefined();
        expect(tx.amount).toBeDefined();
        expect(tx.expires_at).toBeDefined();
      });
    });

    it('should respect limit parameter', async () => {
      const userId = 1;
      const limit = 5;
      
      const history = await getUserExpirationHistory(userId, limit);
      
      expect(history.length).toBeLessThanOrEqual(limit);
    });
  });

  describe('calculateActiveBalance', () => {
    it('should calculate active balance excluding expired', async () => {
      const userId = 1;
      
      const activeBalance = await calculateActiveBalance(userId);
      
      expect(typeof activeBalance).toBe('number');
      expect(activeBalance).toBeGreaterThanOrEqual(0);
    });

    it('should never return negative balance', async () => {
      const userId = 1;
      
      const activeBalance = await calculateActiveBalance(userId);
      
      expect(activeBalance).toBeGreaterThanOrEqual(0);
    });
  });

  describe('getExpirationTimeline', () => {
    it('should provide expiration timeline', async () => {
      const userId = 1;
      
      const timeline = await getExpirationTimeline(userId);
      
      expect(timeline.userId).toBe(userId);
      expect(Array.isArray(timeline.timeline)).toBe(true);
    });

    it('should show days until expiry for each date', async () => {
      const userId = 1;
      
      const timeline = await getExpirationTimeline(userId);
      
      timeline.timeline.forEach(entry => {
        expect(entry.expiryDate).toBeDefined();
        expect(entry.pointsExpiring).toBeGreaterThan(0);
        expect(entry.transactionCount).toBeGreaterThan(0);
        expect(entry.daysUntilExpiry).toBeDefined();
      });
    });

    it('should order timeline by expiry date', async () => {
      const userId = 1;
      
      const timeline = await getExpirationTimeline(userId);
      
      for (let i = 1; i < timeline.timeline.length; i++) {
        expect(
          new Date(timeline.timeline[i].expiryDate) >=
          new Date(timeline.timeline[i - 1].expiryDate)
        ).toBe(true);
      }
    });
  });
});
