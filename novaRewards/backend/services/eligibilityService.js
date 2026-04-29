const { query } = require('../db/index');
const { getUserById } = require('../db/userRepository');
const { getCampaignById } = require('../db/campaignRepository');
const { getRewardById } = require('../db/adminRepository');
const { getUserTotalPoints } = require('../db/pointTransactionRepository');

/**
 * Validates whether a user is eligible to earn rewards for a campaign.
 * 
 * @param {number} userId
 * @param {number} campaignId
 * @returns {Promise<object>} { eligible: boolean, reason?: string, details: object }
 */
async function validateEarningEligibility(userId, campaignId) {
  try {
    // Check user exists
    const user = await getUserById(userId);
    if (!user) {
      return {
        eligible: false,
        reason: 'USER_NOT_FOUND',
        details: { userId },
      };
    }
    
    // Check campaign exists
    const campaign = await getCampaignById(campaignId);
    if (!campaign) {
      return {
        eligible: false,
        reason: 'CAMPAIGN_NOT_FOUND',
        details: { campaignId },
      };
    }
    
    // Check campaign is active
    if (!campaign.is_active) {
      return {
        eligible: false,
        reason: 'CAMPAIGN_INACTIVE',
        details: { campaignName: campaign.name },
      };
    }
    
    // Check campaign date range
    const today = new Date().toISOString().split('T')[0];
    if (today < campaign.start_date || today > campaign.end_date) {
      return {
        eligible: false,
        reason: 'CAMPAIGN_OUT_OF_DATE_RANGE',
        details: {
          startDate: campaign.start_date,
          endDate: campaign.end_date,
          today,
        },
      };
    }
    
    // Check for earning frequency limits (optional daily limit)
    const hasExceededDailyLimit = await checkDailyEarningLimit(userId, campaignId);
    if (hasExceededDailyLimit) {
      return {
        eligible: false,
        reason: 'DAILY_LIMIT_EXCEEDED',
        details: { campaignId },
      };
    }
    
    return {
      eligible: true,
      details: {
        userId,
        campaignId,
        campaignName: campaign.name,
        rewardRate: campaign.reward_rate,
      },
    };
  } catch (error) {
    console.error('Error validating earning eligibility:', error);
    return {
      eligible: false,
      reason: 'VALIDATION_ERROR',
      details: { error: error.message },
    };
  }
}

/**
 * Validates whether a user is eligible to claim (redeem) a reward.
 * 
 * @param {number} userId
 * @param {number} rewardId
 * @returns {Promise<object>} { eligible: boolean, reason?: string, details: object }
 */
async function validateRedemptionEligibility(userId, rewardId) {
  try {
    // Check user exists
    const user = await getUserById(userId);
    if (!user) {
      return {
        eligible: false,
        reason: 'USER_NOT_FOUND',
        details: { userId },
      };
    }
    
    // Check reward exists
    const reward = await getRewardById(rewardId);
    if (!reward) {
      return {
        eligible: false,
        reason: 'REWARD_NOT_FOUND',
        details: { rewardId },
      };
    }
    
    // Check reward is active
    if (!reward.is_active) {
      return {
        eligible: false,
        reason: 'REWARD_INACTIVE',
        details: { rewardName: reward.name },
      };
    }
    
    // Check reward is in stock
    if (reward.quantity_available <= 0) {
      return {
        eligible: false,
        reason: 'REWARD_OUT_OF_STOCK',
        details: { rewardName: reward.name },
      };
    }
    
    // Check user has enough points
    const userTotal = await getUserTotalPoints(userId);
    if (userTotal < reward.points_required) {
      return {
        eligible: false,
        reason: 'INSUFFICIENT_POINTS',
        details: {
          userPoints: userTotal,
          pointsRequired: reward.points_required,
          shortfall: reward.points_required - userTotal,
        },
      };
    }
    
    // Check if reward has minimum tier requirement
    if (reward.min_tier_id) {
      if (!user.tier_id || user.tier_id < reward.min_tier_id) {
        const { rows } = await query(
          `SELECT name FROM tiers WHERE id = $1`,
          [reward.min_tier_id]
        );
        const requiredTier = rows[0]?.name || 'Unknown';
        const userTier = user.tier_id
          ? (await query('SELECT name FROM tiers WHERE id = $1', [user.tier_id])).rows[0]?.name
          : 'No Tier';
        
        return {
          eligible: false,
          reason: 'INSUFFICIENT_TIER',
          details: {
            userTier,
            requiredTier,
            minTierId: reward.min_tier_id,
          },
        };
      }
    }
    
    return {
      eligible: true,
      details: {
        userId,
        rewardId,
        rewardName: reward.name,
        pointsRequired: reward.points_required,
        userPoints: userTotal,
      },
    };
  } catch (error) {
    console.error('Error validating redemption eligibility:', error);
    return {
      eligible: false,
      reason: 'VALIDATION_ERROR',
      details: { error: error.message },
    };
  }
}

/**
 * Checks if user has exceeded daily earning limit for a campaign.
 * Can be extended with per-campaign configuration.
 */
async function checkDailyEarningLimit(userId, campaignId, dailyLimit = null) {
  try {
    // If no daily limit configured, allow
    if (!dailyLimit) {
      return false;
    }
    
    const today = new Date().toISOString().split('T')[0];
    const { rows } = await query(
      `SELECT COUNT(*) as count FROM point_transactions
       WHERE user_id = $1
       AND campaign_id = $2
       AND type = 'earned'
       AND DATE(created_at) = $3`,
      [userId, campaignId, today]
    );
    
    return rows[0].count >= dailyLimit;
  } catch (error) {
    console.error('Error checking daily earning limit:', error);
    return false;
  }
}

/**
 * Gets eligibility summary for a user across multiple rewards.
 */
async function getRedemptionEligibilitySummary(userId) {
  try {
    const user = await getUserById(userId);
    if (!user) {
      throw new Error(`User ${userId} not found`);
    }
    
    const userTotal = await getUserTotalPoints(userId);
    
    // Get all active rewards
    const { rows: rewards } = await query(
      `SELECT id, name, points_required, quantity_available, is_active, min_tier_id
       FROM rewards
       WHERE is_active = TRUE
       ORDER BY points_required ASC`
    );
    
    return {
      userId,
      userTotalPoints: userTotal,
      userTier: user.tier_id ? (await query('SELECT name FROM tiers WHERE id = $1', [user.tier_id])).rows[0]?.name : 'No Tier',
      redeemableRewards: rewards.filter(r => r.quantity_available > 0 && userTotal >= r.points_required).map(r => ({
        id: r.id,
        name: r.name,
        pointsRequired: r.points_required,
        costAtUserTier: r.points_required, // Can be adjusted with multipliers
      })),
      nearbyRewards: rewards.filter(r => {
        const shortfall = r.points_required - userTotal;
        return shortfall > 0 && shortfall <= 100; // Within 100 points
      }).map(r => ({
        id: r.id,
        name: r.name,
        pointsRequired: r.points_required,
        pointsNeeded: r.points_required - userTotal,
      })),
    };
  } catch (error) {
    console.error('Error getting redemption eligibility summary:', error);
    throw error;
  }
}

/**
 * Gets detailed eligibility check for a specific action.
 */
async function detailedEligibilityCheck(userId, action, targetId) {
  if (action === 'earn') {
    return validateEarningEligibility(userId, targetId);
  } else if (action === 'redeem') {
    return validateRedemptionEligibility(userId, targetId);
  }
  
  throw new Error('Invalid action. Must be "earn" or "redeem"');
}

module.exports = {
  validateEarningEligibility,
  validateRedemptionEligibility,
  checkDailyEarningLimit,
  getRedemptionEligibilitySummary,
  detailedEligibilityCheck,
};
