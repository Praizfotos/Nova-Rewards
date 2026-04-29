const {
  getAllTiers,
  getTierById,
  determineTierByPoints,
  getUserCurrentTier,
  updateUserTier,
  getUserTierHistory,
  getPointsToNextTier,
} = require('../db/tierRepository');
const { getUserTotalPoints } = require('../db/pointTransactionRepository');
const { getUserById } = require('../db/userRepository');

/**
 * Calculates and applies tier multiplier to a point amount.
 * 
 * @param {number} basePoints
 * @param {number} tierId
 * @param {string} action - 'earning' or 'redemption'
 * @returns {Promise<number>} Adjusted points
 */
async function applyTierMultiplier(basePoints, tierId, action = 'earning') {
  const tier = await getTierById(tierId);
  if (!tier) {
    return basePoints;
  }
  
  const multiplier = action === 'earning'
    ? tier.earning_multiplier
    : tier.redemption_multiplier;
  
  return Math.round(basePoints * multiplier);
}

/**
 * Automatically promotes/demotes user tier based on total points.
 * Only makes changes if tier threshold is crossed.
 * 
 * @param {number} userId
 * @returns {Promise<object>} { tierId, tierName, changed: boolean }
 */
async function maybeUpdateUserTier(userId) {
  try {
    const user = await getUserById(userId);
    if (!user) {
      throw new Error(`User ${userId} not found`);
    }
    
    const totalPoints = await getUserTotalPoints(userId);
    const newTier = await determineTierByPoints(totalPoints);
    
    if (!newTier) {
      return {
        tierId: null,
        tierName: 'Unclassified',
        changed: false,
        reason: 'No tier matches current points',
      };
    }
    
    const currentTier = await getUserCurrentTier(userId);
    
    // No change needed
    if (currentTier?.id === newTier.id) {
      return {
        tierId: newTier.id,
        tierName: newTier.name,
        changed: false,
      };
    }
    
    // Tier change required
    await updateUserTier(userId, newTier.id, 'auto_tier_update');
    
    return {
      tierId: newTier.id,
      tierName: newTier.name,
      changed: true,
      previousTier: currentTier?.name || 'None',
      reason: `Points threshold crossed: ${totalPoints} points`,
    };
  } catch (error) {
    console.error('Error updating user tier:', error);
    throw error;
  }
}

/**
 * Gets comprehensive tier information for a user.
 */
async function getUserTierInfo(userId) {
  try {
    const user = await getUserById(userId);
    if (!user) {
      throw new Error(`User ${userId} not found`);
    }
    
    const totalPoints = await getUserTotalPoints(userId);
    const currentTier = await getUserCurrentTier(userId);
    const tierProgress = await getPointsToNextTier(userId, totalPoints);
    
    return {
      userId,
      currentTier: currentTier?.name || 'Bronze',
      currentTierId: currentTier?.id,
      totalPoints,
      tierProgress,
      multipliers: {
        earning: currentTier?.earning_multiplier || 1.0,
        redemption: currentTier?.redemption_multiplier || 1.0,
      },
      pointExpirationDays: currentTier?.expiration_days || 365,
    };
  } catch (error) {
    console.error('Error getting user tier info:', error);
    throw error;
  }
}

/**
 * Gets all available tiers with user comparison.
 */
async function getTiersWithUserProgress(userId) {
  try {
    const tiers = await getAllTiers();
    const totalPoints = await getUserTotalPoints(userId);
    const userTier = await getUserCurrentTier(userId);
    
    return tiers.map(tier => ({
      ...tier,
      userCurrentTier: tier.id === userTier?.id,
      pointsToReach: Math.max(0, tier.min_points - totalPoints),
      isReachable: tier.min_points <= totalPoints,
    }));
  } catch (error) {
    console.error('Error getting tiers with progress:', error);
    throw error;
  }
}

/**
 * Gets tier history for display/audit.
 */
async function getTierProgressHistory(userId, limit = 50) {
  return getUserTierHistory(userId, limit);
}

module.exports = {
  applyTierMultiplier,
  maybeUpdateUserTier,
  getUserTierInfo,
  getTiersWithUserProgress,
  getTierProgressHistory,
};
