const express = require('express');
const router = express.Router();
const { authenticateUser } = require('../middleware/authenticateUser');
const {
  getAllTiers,
  getTierById,
  getUserTierInfo,
  getTiersWithUserProgress,
  getTierProgressHistory,
} = require('../services/tierService');
const { getPointsToNextTier } = require('../db/tierRepository');

/**
 * GET /api/tiers
 * Lists all available tiers with earning/redemption multipliers.
 */
router.get('/', async (req, res, next) => {
  try {
    const tiers = await getAllTiers();
    
    res.json({
      success: true,
      data: tiers.map(tier => ({
        id: tier.id,
        name: tier.name,
        minPoints: tier.min_points,
        maxPoints: tier.max_points,
        earningMultiplier: tier.earning_multiplier,
        redemptionMultiplier: tier.redemption_multiplier,
        expirationDays: tier.expiration_days,
      })),
    });
  } catch (err) {
    console.error('Error fetching tiers:', err);
    res.status(500).json({
      success: false,
      error: 'internal_server_error',
      message: err.message || 'Failed to fetch tiers',
    });
  }
});

/**
 * GET /api/tiers/:tierId
 * Gets details for a specific tier.
 */
router.get('/:tierId', async (req, res, next) => {
  try {
    const { tierId } = req.params;
    
    if (!tierId || isNaN(tierId)) {
      return res.status(400).json({
        success: false,
        error: 'validation_error',
        message: 'Invalid tier ID',
      });
    }
    
    const tier = await getTierById(tierId);
    if (!tier) {
      return res.status(404).json({
        success: false,
        error: 'not_found',
        message: 'Tier not found',
      });
    }
    
    res.json({
      success: true,
      data: {
        id: tier.id,
        name: tier.name,
        minPoints: tier.min_points,
        maxPoints: tier.max_points,
        earningMultiplier: tier.earning_multiplier,
        redemptionMultiplier: tier.redemption_multiplier,
        expirationDays: tier.expiration_days,
        createdAt: tier.created_at,
      },
    });
  } catch (err) {
    console.error('Error fetching tier:', err);
    res.status(500).json({
      success: false,
      error: 'internal_server_error',
      message: err.message || 'Failed to fetch tier',
    });
  }
});

/**
 * GET /api/tiers/user/current
 * Gets current tier information for authenticated user.
 * Includes tier progress, multipliers, and next tier info.
 */
router.get('/user/current', authenticateUser, async (req, res, next) => {
  try {
    const tierInfo = await getUserTierInfo(req.user.id);
    
    res.json({
      success: true,
      data: tierInfo,
    });
  } catch (err) {
    console.error('Error fetching user tier:', err);
    res.status(500).json({
      success: false,
      error: 'internal_server_error',
      message: err.message || 'Failed to fetch user tier',
    });
  }
});

/**
 * GET /api/tiers/user/progress
 * Gets all tiers with user's progress toward each.
 */
router.get('/user/progress', authenticateUser, async (req, res, next) => {
  try {
    const tiersWithProgress = await getTiersWithUserProgress(req.user.id);
    
    res.json({
      success: true,
      data: {
        tiers: tiersWithProgress,
      },
    });
  } catch (err) {
    console.error('Error fetching tier progress:', err);
    res.status(500).json({
      success: false,
      error: 'internal_server_error',
      message: err.message || 'Failed to fetch tier progress',
    });
  }
});

/**
 * GET /api/tiers/user/history
 * Gets tier progression history for authenticated user.
 */
router.get('/user/history', authenticateUser, async (req, res, next) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const history = await getTierProgressHistory(req.user.id, limit);
    
    res.json({
      success: true,
      data: {
        tierHistory: history,
        count: history.length,
      },
    });
  } catch (err) {
    console.error('Error fetching tier history:', err);
    res.status(500).json({
      success: false,
      error: 'internal_server_error',
      message: err.message || 'Failed to fetch tier history',
    });
  }
});

module.exports = router;
