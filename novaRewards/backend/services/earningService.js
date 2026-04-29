const { query } = require('../db/index');
const { recordPointTransaction } = require('../db/pointTransactionRepository');
const { applyTierMultiplier, maybeUpdateUserTier } = require('./tierService');
const { getCampaignById } = require('../db/campaignRepository');
const { getUserById } = require('../db/userRepository');

/**
 * Calculates points earned based on transaction amount and campaign rate.
 * Applies tier multiplier if user has an active tier.
 * 
 * @param {number} transactionAmount
 * @param {number} campaignRewardRate
 * @param {number} userId
 * @returns {Promise<number>} Final points to award
 */
async function calculatePointsEarned(transactionAmount, campaignRewardRate, userId) {
  if (!transactionAmount || transactionAmount <= 0) {
    throw new Error('Transaction amount must be positive');
  }
  
  if (!campaignRewardRate || campaignRewardRate <= 0) {
    throw new Error('Campaign reward rate must be positive');
  }
  
  // Base calculation: amount * rate
  const basePoints = Math.round(transactionAmount * campaignRewardRate);
  
  // Apply tier multiplier if user exists and has a tier
  try {
    const user = await getUserById(userId);
    if (user?.tier_id) {
      const adjustedPoints = await applyTierMultiplier(basePoints, user.tier_id, 'earning');
      return adjustedPoints;
    }
  } catch (err) {
    console.warn(`Could not apply tier multiplier for user ${userId}:`, err.message);
  }
  
  return basePoints;
}

/**
 * Records a point earning transaction for a user.
 * Also updates user tier if threshold is crossed.
 * 
 * @param {object} params
 * @param {number} params.userId
 * @param {number} params.transactionAmount
 * @param {number} params.campaignId
 * @param {number} params.campaignRewardRate
 * @param {string} [params.transactionId]
 * @param {string} [params.description]
 * @returns {Promise<object>} Transaction record and tier update info
 */
async function recordPointEarning({
  userId,
  transactionAmount,
  campaignId,
  campaignRewardRate,
  transactionId,
  description,
}) {
  try {
    // Validate inputs
    if (!userId || !transactionAmount || !campaignId || !campaignRewardRate) {
      throw new Error('Missing required parameters for earning');
    }
    
    // Verify campaign exists
    const campaign = await getCampaignById(campaignId);
    if (!campaign) {
      throw new Error(`Campaign ${campaignId} not found`);
    }
    
    // Verify user exists
    const user = await getUserById(userId);
    if (!user) {
      throw new Error(`User ${userId} not found`);
    }
    
    // Calculate points with tier multiplier
    const pointsEarned = await calculatePointsEarned(
      transactionAmount,
      campaignRewardRate,
      userId
    );
    
    // Calculate expiration date based on tier or default
    const expirationDays = user.tier_id
      ? await getExpirationDaysForTier(user.tier_id)
      : 365; // Default expiration
    
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + expirationDays);
    
    // Record the point transaction
    const pointTx = await recordPointTransaction({
      userId,
      type: 'earned',
      amount: pointsEarned,
      campaignId,
      description: description || `Earned from transaction ${transactionId || 'unknown'}`,
    });
    
    // Update expires_at and metadata
    await query(
      `UPDATE point_transactions
       SET expires_at = $1, metadata = $2
       WHERE id = $3`,
      [expiresAt, JSON.stringify({ transactionId, campaignId }), pointTx.id]
    );
    
    // Check if user needs tier promotion/demotion
    const tierUpdate = await maybeUpdateUserTier(userId);
    
    return {
      success: true,
      pointTransaction: {
        ...pointTx,
        expires_at: expiresAt,
      },
      pointsEarned,
      expirationDays,
      tierUpdate,
    };
  } catch (error) {
    console.error('Error recording point earning:', error);
    throw error;
  }
}

/**
 * Gets expiration days for a tier.
 */
async function getExpirationDaysForTier(tierId) {
  try {
    const { rows } = await query(
      `SELECT expiration_days FROM tiers WHERE id = $1`,
      [tierId]
    );
    return rows[0]?.expiration_days || 365;
  } catch (err) {
    console.warn(`Could not get expiration days for tier ${tierId}:`, err.message);
    return 365;
  }
}

/**
 * Processes multiple point earnings in a batch (e.g., from a daily bonus, referral campaign).
 * 
 * @param {array} earnings
 * @returns {Promise<array>} Results for each earning
 */
async function batchRecordEarnings(earnings) {
  const results = [];
  
  for (const earning of earnings) {
    try {
      const result = await recordPointEarning(earning);
      results.push({ ...result, userId: earning.userId, success: true });
    } catch (error) {
      results.push({
        success: false,
        userId: earning.userId,
        error: error.message,
      });
    }
  }
  
  return results;
}

/**
 * Gets earning history for a user.
 */
async function getUserEarningHistory(userId, limit = 50) {
  try {
    const { rows } = await query(
      `SELECT * FROM point_transactions
       WHERE user_id = $1 AND type IN ('earned', 'bonus', 'referral')
       ORDER BY created_at DESC
       LIMIT $2`,
      [userId, limit]
    );
    
    return rows.map(row => ({
      ...row,
      metadata: row.metadata ? JSON.parse(row.metadata) : {},
    }));
  } catch (error) {
    console.error('Error getting earning history:', error);
    throw error;
  }
}

/**
 * Gets earning statistics for a user.
 */
async function getUserEarningStats(userId) {
  try {
    const { rows } = await query(
      `SELECT
         type,
         COUNT(*) as transaction_count,
         SUM(amount) as total_points
       FROM point_transactions
       WHERE user_id = $1 AND type IN ('earned', 'bonus', 'referral')
       GROUP BY type`,
      [userId]
    );
    
    const stats = {
      total: 0,
      earned: 0,
      bonus: 0,
      referral: 0,
      transactionCounts: {},
    };
    
    rows.forEach(row => {
      stats[row.type] = parseFloat(row.total_points) || 0;
      stats.total += stats[row.type];
      stats.transactionCounts[row.type] = row.transaction_count;
    });
    
    return stats;
  } catch (error) {
    console.error('Error getting earning stats:', error);
    throw error;
  }
}

module.exports = {
  calculatePointsEarned,
  recordPointEarning,
  batchRecordEarnings,
  getUserEarningHistory,
  getUserEarningStats,
  getExpirationDaysForTier,
};
