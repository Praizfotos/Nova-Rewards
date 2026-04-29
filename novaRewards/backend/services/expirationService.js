const { query } = require('../db/index');
const { getUserTotalPoints } = require('../db/pointTransactionRepository');

/**
 * Marks expired points as expired in the database.
 * Points that have passed their expiration date are flagged and balance is updated.
 * 
 * @returns {Promise<object>} { expiredCount: number, pointsExpired: number }
 */
async function markExpiredPoints() {
  try {
    const { rows } = await query(
      `UPDATE point_transactions
       SET is_expired = TRUE
       WHERE is_expired = FALSE
       AND expires_at IS NOT NULL
       AND expires_at < NOW()
       AND type IN ('earned', 'bonus', 'referral')
       RETURNING id, user_id, amount`
    );
    
    let totalPointsExpired = 0;
    rows.forEach(row => {
      totalPointsExpired += parseFloat(row.amount) || 0;
    });
    
    return {
      success: true,
      expiredCount: rows.length,
      pointsExpired: totalPointsExpired,
      message: `Marked ${rows.length} expired point transactions`,
    };
  } catch (error) {
    console.error('Error marking expired points:', error);
    throw error;
  }
}

/**
 * Gets expiring soon points for a user (e.g., within 7 days).
 * Useful for notifications.
 */
async function getExpiringPointsWarning(userId, daysUntilExpiry = 7) {
  try {
    const expiryDate = new Date();
    expiryDate.setDate(expiryDate.getDate() + daysUntilExpiry);
    
    const { rows } = await query(
      `SELECT 
         id, amount, expires_at, type, campaign_id, description,
         (expires_at::date - NOW()::date) as days_until_expiry
       FROM point_transactions
       WHERE user_id = $1
       AND is_expired = FALSE
       AND expires_at IS NOT NULL
       AND expires_at <= $2
       AND type IN ('earned', 'bonus', 'referral')
       ORDER BY expires_at ASC`,
      [userId, expiryDate]
    );
    
    let totalAtRisk = 0;
    rows.forEach(row => {
      totalAtRisk += parseFloat(row.amount) || 0;
    });
    
    return {
      userId,
      expiringPointsCount: rows.length,
      totalPointsAtRisk: totalAtRisk,
      expiredTransactions: rows,
      warningThreshold: daysUntilExpiry,
    };
  } catch (error) {
    console.error('Error getting expiring points warning:', error);
    throw error;
  }
}

/**
 * Gets expiration statistics for a user.
 */
async function getUserExpirationStats(userId) {
  try {
    const { rows } = await query(
      `SELECT
         SUM(CASE WHEN is_expired = TRUE THEN amount ELSE 0 END) as expired_points,
         SUM(CASE WHEN is_expired = FALSE AND expires_at IS NOT NULL AND expires_at > NOW() THEN amount ELSE 0 END) as active_points,
         COUNT(CASE WHEN is_expired = TRUE THEN 1 END) as expired_count,
         COUNT(CASE WHEN is_expired = FALSE AND expires_at IS NOT NULL AND expires_at > NOW() THEN 1 END) as active_count,
         MIN(CASE WHEN is_expired = FALSE AND expires_at IS NOT NULL AND expires_at > NOW() THEN expires_at END) as next_expiry_date
       FROM point_transactions
       WHERE user_id = $1 AND type IN ('earned', 'bonus', 'referral')`,
      [userId]
    );
    
    const stats = rows[0];
    return {
      userId,
      expiredPoints: parseFloat(stats.expired_points) || 0,
      activePoints: parseFloat(stats.active_points) || 0,
      expiredTransactionCount: stats.expired_count || 0,
      activeTransactionCount: stats.active_count || 0,
      nextExpiryDate: stats.next_expiry_date || null,
    };
  } catch (error) {
    console.error('Error getting expiration stats:', error);
    throw error;
  }
}

/**
 * Gets expiration history for a user (recently expired points).
 */
async function getUserExpirationHistory(userId, limit = 50) {
  try {
    const { rows } = await query(
      `SELECT 
         id, amount, type, expires_at, created_at, campaign_id, description
       FROM point_transactions
       WHERE user_id = $1
       AND is_expired = TRUE
       AND type IN ('earned', 'bonus', 'referral')
       ORDER BY expires_at DESC
       LIMIT $2`,
      [userId, limit]
    );
    
    return rows;
  } catch (error) {
    console.error('Error getting expiration history:', error);
    throw error;
  }
}

/**
 * Calculates active balance excluding expired points.
 * This is the true available balance for redemption.
 */
async function calculateActiveBalance(userId) {
  try {
    const { rows } = await query(
      `SELECT
         SUM(CASE 
           WHEN type IN ('earned', 'bonus', 'referral') AND is_expired = FALSE 
           THEN amount 
           WHEN type IN ('redeemed', 'expired') 
           THEN -amount 
           ELSE 0 
         END) as active_balance
       FROM point_transactions
       WHERE user_id = $1`,
      [userId]
    );
    
    return Math.max(0, parseFloat(rows[0]?.active_balance) || 0);
  } catch (error) {
    console.error('Error calculating active balance:', error);
    throw error;
  }
}

/**
 * Gets expiration timeline (breakdown by expiry date).
 * Useful for visualizing point expiration schedule.
 */
async function getExpirationTimeline(userId) {
  try {
    const { rows } = await query(
      `SELECT
         DATE(expires_at) as expiry_date,
         SUM(amount) as total_points,
         COUNT(*) as transaction_count,
         (DATE(expires_at) - NOW()::date) as days_until_expiry
       FROM point_transactions
       WHERE user_id = $1
       AND is_expired = FALSE
       AND expires_at IS NOT NULL
       AND type IN ('earned', 'bonus', 'referral')
       GROUP BY DATE(expires_at)
       ORDER BY expires_at ASC`,
      [userId]
    );
    
    return {
      userId,
      timeline: rows.map(row => ({
        expiryDate: row.expiry_date,
        pointsExpiring: parseFloat(row.total_points) || 0,
        transactionCount: row.transaction_count,
        daysUntilExpiry: row.days_until_expiry,
      })),
    };
  } catch (error) {
    console.error('Error getting expiration timeline:', error);
    throw error;
  }
}

/**
 * Updates tier-specific expiration dates if tier changes.
 * When a user is promoted/demoted, their point expiration policy may change.
 */
async function updateExpirationForTierChange(userId, newTierId) {
  try {
    // Get the new tier's expiration days
    const { rows: tierRows } = await query(
      `SELECT expiration_days FROM tiers WHERE id = $1`,
      [newTierId]
    );
    
    if (tierRows.length === 0) {
      throw new Error(`Tier ${newTierId} not found`);
    }
    
    const expirationDays = tierRows[0].expiration_days;
    
    // Update future expiration dates for non-expired, non-redeemed points
    const { rows } = await query(
      `UPDATE point_transactions
       SET expires_at = NOW() + (to_char($2, '999') || ' days')::INTERVAL
       WHERE user_id = $1
       AND is_expired = FALSE
       AND expires_at > NOW()
       AND type IN ('earned', 'bonus', 'referral')
       RETURNING id, expires_at`,
      [userId, expirationDays]
    );
    
    return {
      success: true,
      updatedCount: rows.length,
      newExpirationDays: expirationDays,
      message: `Updated expiration for ${rows.length} active point transactions`,
    };
  } catch (error) {
    console.error('Error updating expiration for tier change:', error);
    throw error;
  }
}

module.exports = {
  markExpiredPoints,
  getExpiringPointsWarning,
  getUserExpirationStats,
  getUserExpirationHistory,
  calculateActiveBalance,
  getExpirationTimeline,
  updateExpirationForTierChange,
};
