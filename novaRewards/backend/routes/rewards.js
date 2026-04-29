const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { createHash } = require('crypto');
const { query } = require('../db/index');
const { getCampaignById, getActiveCampaign } = require('../db/campaignRepository');
const { recordTransaction } = require('../db/transactionRepository');
const { distributeRewards } = require('../../blockchain/sendRewards');
const { isValidStellarAddress } = require('../../blockchain/stellarService');
const { authenticateMerchant } = require('../middleware/authenticateMerchant');
const { authenticateUser } = require('../middleware/authenticateUser');
const { verifyTrustline } = require('../services/stellar');
const { recordPointEarning, getUserEarningHistory, getUserEarningStats } = require('../services/earningService');
const { validateEarningEligibility } = require('../services/eligibilityService');

/**
 * Rate limiter: max 20 requests per minute per IP on the distribute endpoint.
 * Closes: #123
 */
const distributeRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'rate_limit_exceeded',
    message: 'Too many requests. Please try again later.',
  },
});

/**
 * POST /api/rewards/distribute
 * Distributes NOVA tokens to a customer wallet.
 * Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 7.4, 7.5
 */
router.post('/distribute', distributeRateLimiter, authenticateMerchant, async (req, res, next) => {
  try {
    const { walletAddress, amount, campaignId } = req.body;

    if (!walletAddress || !amount) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: walletAddress and amount are required',
      });
    }

    if (amount <= 0) {
      return res.status(400).json({
        success: false,
        error: 'Amount must be greater than zero',
      });
    }

    // Verify trustline exists
    const hasTrustline = await verifyTrustline(walletAddress);
    if (!hasTrustline) {
      return res.status(400).json({
        success: false,
        error: 'no_trustline',
        message: 'Recipient does not have a NOVA trustline. Please add NOVA trustline first.',
      });
    }

    // Distinguish campaign not found vs inactive/expired for clearer client handling.
    const campaignExists = await getCampaignById(campaignId);
    if (!campaignExists) {
      return res.status(404).json({
        success: false,
        error: 'not_found',
        message: 'Campaign does not exist',
      });
    }

    // Validate campaign is active and belongs to this merchant
    const campaign = await getActiveCampaign(campaignId);
    if (!campaign) {
      return res.status(400).json({
        success: false,
        error: 'invalid_campaign',
        message: 'Campaign is expired or inactive',
      });
    }

    if (campaign.merchant_id !== req.merchant.id) {
      return res.status(403).json({
        success: false,
        error: 'forbidden',
        message: 'Campaign does not belong to this merchant',
      });
    }

    // Distribute rewards
    const result = await distributeRewards({
      recipient: walletAddress,
      amount,
      campaignId,
    });

    res.json({ success: true, txHash: result.txHash, transaction: result.tx });
  } catch (err) {
    if (err.code === 'no_trustline') {
      return res.status(400).json({
        success: false,
        error: 'no_trustline',
        message: err.message,
      });
    }
    
    console.error('Error distributing rewards:', err);
    res.status(500).json({
      success: false,
      error: 'internal_server_error',
      message: err.message || 'Failed to distribute rewards',
    });
  }
});

/**
 * POST /api/rewards/earn
 * Records point earnings for a user based on a transaction.
 * Validates eligibility, calculates points with tier multiplier, and records earning.
 * 
 * Authentication: Merchant or authorized system
 * Body: { userId, transactionAmount, campaignId, transactionId?, description? }
 */
router.post('/earn', authenticateMerchant, async (req, res, next) => {
  try {
    const { userId, transactionAmount, campaignId, transactionId, description } = req.body;

    // Validate required fields
    if (!userId || !transactionAmount || !campaignId) {
      return res.status(400).json({
        success: false,
        error: 'validation_error',
        message: 'Missing required fields: userId, transactionAmount, campaignId',
      });
    }

    if (transactionAmount <= 0) {
      return res.status(400).json({
        success: false,
        error: 'validation_error',
        message: 'Transaction amount must be positive',
      });
    }

    // Validate earning eligibility
    const eligibility = await validateEarningEligibility(userId, campaignId);
    if (!eligibility.eligible) {
      return res.status(400).json({
        success: false,
        error: eligibility.reason,
        message: `User is not eligible to earn: ${eligibility.reason}`,
        details: eligibility.details,
      });
    }

    // Record the earning
    const result = await recordPointEarning({
      userId,
      transactionAmount,
      campaignId,
      campaignRewardRate: eligibility.details.rewardRate,
      transactionId,
      description,
    });

    res.status(201).json({
      success: true,
      data: {
        pointsEarned: result.pointsEarned,
        expirationDays: result.expirationDays,
        expiresAt: result.pointTransaction.expires_at,
        tierUpdate: result.tierUpdate,
        transaction: result.pointTransaction,
      },
    });
  } catch (err) {
    console.error('Error recording point earning:', err);
    res.status(500).json({
      success: false,
      error: 'internal_server_error',
      message: err.message || 'Failed to record point earning',
    });
  }
});

/**
 * GET /api/rewards/earning-history
 * Gets earning history for the authenticated user.
 * 
 * Authentication: User
 * Query: { limit?: number }
 */
router.get('/earning-history', authenticateUser, async (req, res, next) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    
    const history = await getUserEarningHistory(req.user.id, limit);
    
    res.json({
      success: true,
      data: {
        earningHistory: history,
        count: history.length,
      },
    });
  } catch (err) {
    console.error('Error getting earning history:', err);
    res.status(500).json({
      success: false,
      error: 'internal_server_error',
      message: err.message || 'Failed to get earning history',
    });
  }
});

/**
 * GET /api/rewards/earning-stats
 * Gets earning statistics for the authenticated user.
 * 
 * Authentication: User
 */
router.get('/earning-stats', authenticateUser, async (req, res, next) => {
  try {
    const stats = await getUserEarningStats(req.user.id);
    
    res.json({
      success: true,
      data: stats,
    });
  } catch (err) {
    console.error('Error getting earning stats:', err);
    res.status(500).json({
      success: false,
      error: 'internal_server_error',
      message: err.message || 'Failed to get earning stats',
    });
  }
});

module.exports = router;