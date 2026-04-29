const { query } = require('../db/index');

/**
 * Retrieves all available tiers, ordered by minimum points.
 */
async function getAllTiers() {
  const { rows } = await query(
    `SELECT * FROM tiers ORDER BY min_points ASC`
  );
  return rows;
}

/**
 * Gets tier by ID.
 */
async function getTierById(tierId) {
  const { rows } = await query(
    `SELECT * FROM tiers WHERE id = $1`,
    [tierId]
  );
  return rows[0] || null;
}

/**
 * Gets tier by name.
 */
async function getTierByName(name) {
  const { rows } = await query(
    `SELECT * FROM tiers WHERE name = $1`,
    [name]
  );
  return rows[0] || null;
}

/**
 * Determines the appropriate tier for a user based on total points.
 * 
 * @param {number} totalPoints - User's total points
 * @returns {Promise<object>} Tier object or null if no tier matches
 */
async function determineTierByPoints(totalPoints) {
  const { rows } = await query(
    `SELECT * FROM tiers
     WHERE min_points <= $1
     AND (max_points IS NULL OR max_points > $1)
     ORDER BY min_points DESC
     LIMIT 1`,
    [totalPoints]
  );
  return rows[0] || null;
}

/**
 * Gets user's current tier.
 */
async function getUserCurrentTier(userId) {
  const { rows } = await query(
    `SELECT t.* FROM tiers t
     JOIN users u ON u.tier_id = t.id
     WHERE u.id = $1`,
    [userId]
  );
  return rows[0] || null;
}

/**
 * Records a tier change in history.
 */
async function recordTierChange(userId, fromTierId, toTierId, reason = null) {
  const { rows } = await query(
    `INSERT INTO tier_history (user_id, from_tier_id, to_tier_id, reason)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [userId, fromTierId, toTierId, reason]
  );
  return rows[0];
}

/**
 * Updates user's tier and records the change.
 * 
 * @param {number} userId
 * @param {number} newTierId
 * @param {string} reason - Optional reason for tier change
 */
async function updateUserTier(userId, newTierId, reason = 'points_threshold_reached') {
  const { rows } = await query(
    `UPDATE users
     SET tier_id = $1, tier_updated_at = NOW()
     WHERE id = $2
     RETURNING *`,
    [newTierId, userId]
  );
  
  if (rows.length > 0) {
    // Record the tier change
    const previousTier = rows[0].tier_id;
    await recordTierChange(userId, previousTier, newTierId, reason);
  }
  
  return rows[0] || null;
}

/**
 * Gets tier history for a user.
 */
async function getUserTierHistory(userId, limit = 20) {
  const { rows } = await query(
    `SELECT 
       th.*,
       from_tier.name as from_tier_name,
       to_tier.name as to_tier_name
     FROM tier_history th
     LEFT JOIN tiers from_tier ON th.from_tier_id = from_tier.id
     JOIN tiers to_tier ON th.to_tier_id = to_tier.id
     WHERE th.user_id = $1
     ORDER BY th.created_at DESC
     LIMIT $2`,
    [userId, limit]
  );
  return rows;
}

/**
 * Gets points needed to reach next tier.
 */
async function getPointsToNextTier(userId, currentTotalPoints) {
  const currentTier = await determineTierByPoints(currentTotalPoints);
  
  // Get the next tier (by minimum points)
  const { rows } = await query(
    `SELECT * FROM tiers
     WHERE min_points > $1
     ORDER BY min_points ASC
     LIMIT 1`,
    [currentTier?.min_points || 0]
  );
  
  if (rows.length === 0) {
    return {
      currentTier: currentTier?.name || 'Bronze',
      nextTier: null,
      pointsNeeded: 0,
      isMaxTier: true,
    };
  }
  
  const nextTier = rows[0];
  return {
    currentTier: currentTier?.name || 'Bronze',
    nextTier: nextTier.name,
    pointsNeeded: Math.max(0, nextTier.min_points - currentTotalPoints),
    pointsUntilNextTier: nextTier.min_points,
    isMaxTier: false,
  };
}

module.exports = {
  getAllTiers,
  getTierById,
  getTierByName,
  determineTierByPoints,
  getUserCurrentTier,
  recordTierChange,
  updateUserTier,
  getUserTierHistory,
  getPointsToNextTier,
};
