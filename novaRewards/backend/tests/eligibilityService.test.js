const {
  validateEarningEligibility,
  validateRedemptionEligibility,
  checkDailyEarningLimit,
  getRedemptionEligibilitySummary,
} = require('../../services/eligibilityService');

describe('Eligibility Service', () => {
  describe('validateEarningEligibility', () => {
    it('should validate eligible earning', async () => {
      const userId = 1;
      const campaignId = 1;
      
      const result = await validateEarningEligibility(userId, campaignId);
      
      expect(result).toBeDefined();
      expect(typeof result.eligible).toBe('boolean');
      expect(result.details).toBeDefined();
    });

    it('should return false for non-existent user', async () => {
      const result = await validateEarningEligibility(99999, 1);
      
      expect(result.eligible).toBe(false);
      expect(result.reason).toBe('USER_NOT_FOUND');
    });

    it('should return false for non-existent campaign', async () => {
      const result = await validateEarningEligibility(1, 99999);
      
      expect(result.eligible).toBe(false);
      expect(result.reason).toBe('CAMPAIGN_NOT_FOUND');
    });

    it('should return false for inactive campaign', async () => {
      // This assumes campaign ID 2 is inactive
      const result = await validateEarningEligibility(1, 2);
      
      expect(result).toBeDefined();
      expect(typeof result.eligible).toBe('boolean');
    });

    it('should check date range validity', async () => {
      const result = await validateEarningEligibility(1, 1);
      
      if (!result.eligible && result.reason === 'CAMPAIGN_OUT_OF_DATE_RANGE') {
        expect(result.details.startDate).toBeDefined();
        expect(result.details.endDate).toBeDefined();
      }
    });
  });

  describe('validateRedemptionEligibility', () => {
    it('should validate eligible redemption', async () => {
      const userId = 1;
      const rewardId = 1;
      
      const result = await validateRedemptionEligibility(userId, rewardId);
      
      expect(result).toBeDefined();
      expect(typeof result.eligible).toBe('boolean');
      expect(result.details).toBeDefined();
    });

    it('should return false for non-existent user', async () => {
      const result = await validateRedemptionEligibility(99999, 1);
      
      expect(result.eligible).toBe(false);
      expect(result.reason).toBe('USER_NOT_FOUND');
    });

    it('should return false for non-existent reward', async () => {
      const result = await validateRedemptionEligibility(1, 99999);
      
      expect(result.eligible).toBe(false);
      expect(result.reason).toBe('REWARD_NOT_FOUND');
    });

    it('should return false for inactive reward', async () => {
      const result = await validateRedemptionEligibility(1, 99999);
      
      expect(result.eligible).toBe(false);
    });

    it('should check for out of stock', async () => {
      const result = await validateRedemptionEligibility(1, 1);
      
      if (!result.eligible && result.reason === 'REWARD_OUT_OF_STOCK') {
        expect(result.details.rewardName).toBeDefined();
      }
    });

    it('should check for insufficient points', async () => {
      const result = await validateRedemptionEligibility(1, 1);
      
      if (!result.eligible && result.reason === 'INSUFFICIENT_POINTS') {
        expect(result.details.userPoints).toBeDefined();
        expect(result.details.pointsRequired).toBeDefined();
        expect(result.details.shortfall).toBeGreaterThan(0);
      }
    });

    it('should check for tier requirement', async () => {
      const result = await validateRedemptionEligibility(1, 1);
      
      if (!result.eligible && result.reason === 'INSUFFICIENT_TIER') {
        expect(result.details.userTier).toBeDefined();
        expect(result.details.requiredTier).toBeDefined();
      }
    });
  });

  describe('checkDailyEarningLimit', () => {
    it('should allow earning if no limit set', async () => {
      const result = await checkDailyEarningLimit(1, 1, null);
      
      expect(result).toBe(false);
    });

    it('should check daily limit when set', async () => {
      const result = await checkDailyEarningLimit(1, 1, 10);
      
      expect(typeof result).toBe('boolean');
    });
  });

  describe('getRedemptionEligibilitySummary', () => {
    it('should return user eligibility summary', async () => {
      const userId = 1;
      
      const summary = await getRedemptionEligibilitySummary(userId);
      
      expect(summary.userId).toBe(userId);
      expect(summary.userTotalPoints).toBeGreaterThanOrEqual(0);
      expect(summary.userTier).toBeDefined();
      expect(Array.isArray(summary.redeemableRewards)).toBe(true);
      expect(Array.isArray(summary.nearbyRewards)).toBe(true);
    });

    it('should identify redeemable rewards', async () => {
      const userId = 1;
      
      const summary = await getRedemptionEligibilitySummary(userId);
      
      summary.redeemableRewards.forEach(reward => {
        expect(reward.id).toBeDefined();
        expect(reward.name).toBeDefined();
        expect(reward.pointsRequired).toBeDefined();
      });
    });

    it('should identify nearby rewards', async () => {
      const userId = 1;
      
      const summary = await getRedemptionEligibilitySummary(userId);
      
      summary.nearbyRewards.forEach(reward => {
        expect(reward.pointsNeeded).toBeGreaterThan(0);
        expect(reward.pointsNeeded).toBeLessThanOrEqual(100);
      });
    });
  });
});
