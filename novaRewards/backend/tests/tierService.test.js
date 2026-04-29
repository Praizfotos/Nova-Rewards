const {
  applyTierMultiplier,
  maybeUpdateUserTier,
  getUserTierInfo,
  getTiersWithUserProgress,
} = require('../../services/tierService');
const {
  getAllTiers,
  determineTierByPoints,
  getUserCurrentTier,
} = require('../../db/tierRepository');

describe('Tier Service', () => {
  describe('applyTierMultiplier', () => {
    it('should apply earning multiplier correctly', async () => {
      // Assuming tier ID 2 is Silver with 1.10 multiplier
      const basePoints = 100;
      const adjustedPoints = await applyTierMultiplier(basePoints, 2, 'earning');
      
      expect(adjustedPoints).toBe(110);
    });

    it('should apply redemption multiplier correctly', async () => {
      // Assuming tier ID 3 is Gold with 1.10 redemption multiplier
      const basePoints = 100;
      const adjustedPoints = await applyTierMultiplier(basePoints, 3, 'redemption');
      
      expect(adjustedPoints).toBeGreaterThanOrEqual(100);
    });

    it('should return base points if tier not found', async () => {
      const basePoints = 100;
      const adjustedPoints = await applyTierMultiplier(basePoints, 99999, 'earning');
      
      expect(adjustedPoints).toBe(basePoints);
    });

    it('should round result to nearest integer', async () => {
      const basePoints = 33;
      const adjustedPoints = await applyTierMultiplier(basePoints, 2, 'earning');
      
      expect(Number.isInteger(adjustedPoints)).toBe(true);
    });
  });

  describe('maybeUpdateUserTier', () => {
    it('should update tier when points cross threshold', async () => {
      const userId = 1;
      
      const result = await maybeUpdateUserTier(userId);
      
      expect(result).toBeDefined();
      expect(result.tierId).toBeDefined();
      expect(result.tierName).toBeDefined();
      expect(typeof result.changed).toBe('boolean');
    });

    it('should not change tier if already at correct tier', async () => {
      const userId = 1;
      
      // First call to establish a tier
      const firstUpdate = await maybeUpdateUserTier(userId);
      
      // Second call should show no change
      const secondUpdate = await maybeUpdateUserTier(userId);
      
      expect(secondUpdate.changed).toBe(false);
      expect(secondUpdate.tierId).toBe(firstUpdate.tierId);
    });

    it('should throw error for non-existent user', async () => {
      try {
        await maybeUpdateUserTier(99999);
        fail('Should have thrown error');
      } catch (err) {
        expect(err.message).toContain('not found');
      }
    });
  });

  describe('getUserTierInfo', () => {
    it('should return comprehensive tier information', async () => {
      const userId = 1;
      
      const tierInfo = await getUserTierInfo(userId);
      
      expect(tierInfo.userId).toBe(userId);
      expect(tierInfo.currentTier).toBeDefined();
      expect(tierInfo.totalPoints).toBeDefined();
      expect(tierInfo.tierProgress).toBeDefined();
      expect(tierInfo.multipliers).toBeDefined();
      expect(tierInfo.multipliers.earning).toBeGreaterThan(0);
      expect(tierInfo.multipliers.redemption).toBeGreaterThan(0);
      expect(tierInfo.pointExpirationDays).toBeGreaterThan(0);
    });

    it('should show points needed to reach next tier', async () => {
      const userId = 1;
      
      const tierInfo = await getUserTierInfo(userId);
      
      if (!tierInfo.tierProgress.isMaxTier) {
        expect(tierInfo.tierProgress.nextTier).toBeDefined();
        expect(tierInfo.tierProgress.pointsNeeded).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe('getTiersWithUserProgress', () => {
    it('should return all tiers with progress', async () => {
      const userId = 1;
      
      const tiersWithProgress = await getTiersWithUserProgress(userId);
      
      expect(Array.isArray(tiersWithProgress)).toBe(true);
      expect(tiersWithProgress.length).toBeGreaterThan(0);
      
      tiersWithProgress.forEach(tier => {
        expect(tier.id).toBeDefined();
        expect(tier.name).toBeDefined();
        expect(typeof tier.userCurrentTier).toBe('boolean');
        expect(tier.pointsToReach).toBeGreaterThanOrEqual(0);
        expect(typeof tier.isReachable).toBe('boolean');
      });
    });

    it('should mark current tier correctly', async () => {
      const userId = 1;
      
      const tiersWithProgress = await getTiersWithUserProgress(userId);
      
      const currentTiers = tiersWithProgress.filter(t => t.userCurrentTier);
      expect(currentTiers.length).toBeLessThanOrEqual(1);
    });
  });

  describe('getAllTiers', () => {
    it('should return all tiers ordered by minimum points', async () => {
      const tiers = await getAllTiers();
      
      expect(Array.isArray(tiers)).toBe(true);
      expect(tiers.length).toBeGreaterThan(0);
      
      // Check tiers are ordered by min_points
      for (let i = 1; i < tiers.length; i++) {
        expect(tiers[i].min_points).toBeGreaterThanOrEqual(tiers[i - 1].min_points);
      }
    });

    it('should have valid multiplier values', async () => {
      const tiers = await getAllTiers();
      
      tiers.forEach(tier => {
        expect(tier.earning_multiplier).toBeGreaterThan(0);
        expect(tier.redemption_multiplier).toBeGreaterThan(0);
        expect(tier.expiration_days).toBeGreaterThan(0);
      });
    });
  });

  describe('determineTierByPoints', () => {
    it('should determine tier for Bronze range', async () => {
      const tier = await determineTierByPoints(500);
      
      expect(tier).toBeDefined();
      expect(tier.name).toBe('Bronze');
    });

    it('should determine tier for higher point ranges', async () => {
      const silverTier = await determineTierByPoints(2000);
      const goldTier = await determineTierByPoints(7000);
      const platinumTier = await determineTierByPoints(12000);
      
      expect(silverTier.name).toBe('Silver');
      expect(goldTier.name).toBe('Gold');
      expect(platinumTier.name).toBe('Platinum');
    });

    it('should return highest tier for very high points', async () => {
      const tier = await determineTierByPoints(1000000);
      
      expect(tier).toBeDefined();
      expect(tier.name).toBe('Platinum');
    });
  });
});
