# Nova Rewards - Quick Implementation Guide

## What's Already Working ✅

| Feature | Status | Location |
|---------|--------|----------|
| Point Redemption | ✅ Complete | `routes/redemptions.js` |
| Referral Tracking | ✅ Complete | `services/referralService.js` |
| Leaderboard | ✅ Complete | `routes/leaderboard.js` |
| Drops/Airdrops | ✅ ~90% | `services/dropService.js` |
| Campaign Management | ✅ Complete | `routes/campaigns.js` |
| Merchant Distribution | ✅ Complete | `routes/rewards.js` |
| Email Notifications | ✅ Complete | `services/emailService.js` |
| Blockchain Integration | ✅ Partial | `blockchain/sendRewards.js` |

---

## What's Missing ❌

### 1. POINT EARNING (Most Critical)

**What needs to be built:**
- Service to calculate points from transactions
- API endpoint for merchants/POS to report purchases
- Automatic point allocation

**Current workaround:**
Merchants manually call `/api/rewards/distribute` with NOVA tokens (backward)

**Files to create/modify:**
```
NEW: backend/services/earningService.js
NEW: db/earningRepository.js
MODIFY: backend/routes/rewards.js (add POST /earn endpoint)
MODIFY: novaRewards/database/015_create_earnings_table.sql
```

**Implementation sketch:**
```javascript
// backend/services/earningService.js
async function calculatePointsEarned(transactionAmount, campaignRewardRate) {
  // Simple: amount * rate
  // Advanced: apply user tier multiplier
  return transactionAmount * campaignRewardRate;
}

async function recordEarning(userId, transactionId, campaignId, amount) {
  const pointsEarned = await calculatePointsEarned(amount, campaign.reward_rate);
  return recordPointTransaction({
    userId,
    type: 'earned',
    amount: pointsEarned,
    campaignId,
    description: `Earned from transaction ${transactionId}`
  });
}
```

**API Endpoint:**
```javascript
// backend/routes/rewards.js
router.post('/earn', authenticateMerchant, async (req, res) => {
  const { userId, amount, campaignId } = req.body;
  // Verify campaign belongs to merchant
  // Call earningService.recordEarning()
  // Return: {success: true, pointsEarned: N, newBalance: M}
});
```

---

### 2. TIER SYSTEM (High Priority)

**Database changes needed:**
```sql
-- New: tiers table
CREATE TABLE tiers (
  id SERIAL PRIMARY KEY,
  name VARCHAR(50) UNIQUE,
  min_points INTEGER NOT NULL,
  earning_multiplier NUMERIC(3,2) DEFAULT 1.0,
  redemption_multiplier NUMERIC(3,2) DEFAULT 1.0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- New: tier_history for audit trail
CREATE TABLE tier_history (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  from_tier_id INTEGER REFERENCES tiers(id),
  to_tier_id INTEGER REFERENCES tiers(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Modify: users table
ALTER TABLE users ADD COLUMN tier_id INTEGER REFERENCES tiers(id);
ALTER TABLE users ADD COLUMN tier_updated_at TIMESTAMPTZ;
```

**Service layer needed:**
```javascript
// backend/services/tierService.js
async function calculateUserTier(userId) {
  const totalPoints = await getUserTotalPoints(userId);
  // Find applicable tier from tiers table
  return determineTier(totalPoints);
}

async function maybeUpdateUserTier(userId) {
  const newTier = await calculateUserTier(userId);
  const currentTier = await getUserCurrentTier(userId);
  
  if (newTier.id !== currentTier.id) {
    // Update user tier
    // Record in tier_history
    // Emit tier.upgraded or tier.downgraded event
  }
}

function getTierMultiplier(tierId, action) {
  // action: 'earning' or 'redemption'
  // return: multiplier value
}
```

**Routes needed:**
```javascript
// backend/routes/tiers.js (NEW)
router.get('/', async (req, res) => {
  // List all tiers
});

router.get('/:userId/current', async (req, res) => {
  // Get user's current tier and progress
});

router.get('/:tierId/requirements', async (req, res) => {
  // Show what's needed to reach this tier
});
```

**Modify existing earning logic:**
```javascript
// When recording earnings, apply tier multiplier:
const userTier = await tierService.calculateUserTier(userId);
const multiplier = tierService.getTierMultiplier(userTier.id, 'earning');
const finalPoints = basePoints * multiplier;

await recordPointTransaction({..., amount: finalPoints});
```

---

### 3. POINT EXPIRATION (Medium Priority)

**Database migration needed:**
```sql
-- Migration: 015_add_expiration_tracking.sql
ALTER TABLE point_transactions ADD COLUMN expires_at TIMESTAMPTZ;

-- For newly earned points:
INSERT INTO point_transactions (..., expires_at)
  VALUES (..., NOW() + INTERVAL '365 days');

-- For already-earned points:
UPDATE point_transactions 
  SET expires_at = created_at + INTERVAL '365 days'
  WHERE type = 'earned' AND expires_at IS NULL;
```

**Service needed:**
```javascript
// backend/services/expirationService.js
async function expireOldPoints() {
  const expiredPoints = await query(`
    SELECT user_id, SUM(amount) as total
    FROM point_transactions
    WHERE type = 'earned' 
      AND expires_at < NOW()
      AND NOT EXISTS (
        SELECT 1 FROM point_transactions pt2
        WHERE pt2.user_id = point_transactions.user_id
          AND pt2.type = 'expired'
          AND pt2.created_at > NOW() - INTERVAL '1 day'
      )
    GROUP BY user_id
  `);
  
  for (const {user_id, total} of expiredPoints) {
    await recordPointTransaction({
      userId: user_id,
      type: 'expired',
      amount: total,
      description: 'Points expired (1 year old)'
    });
    
    // Emit event for email notification
    appEvents.emit('points.expired', {userId: user_id, amount: total});
  }
}

// Scheduler (in server.js):
const schedule = require('node-schedule');
schedule.scheduleJob('0 2 * * *', expirationService.expireOldPoints);
// Runs daily at 2 AM
```

**Email notification:**
```javascript
// Modify emailService.js to add:
async function sendPointsExpiryWarning(email, expiringPoints, expirationDate) {
  // 30-day warning before expiry
}

async function sendPointsExpiredConfirmation(email, expiredAmount) {
  // Confirmation after expiration
}
```

---

### 4. ANALYTICS (Lower Priority but Important)

**Service needed:**
```javascript
// backend/services/analyticsService.js

async function getMerchantAnalytics(merchantId, dateRange) {
  return {
    totalDistributed: sum of rewards.distribute calls,
    totalRedeemed: sum of redemptions,
    redemptionRate: redeemed / distributed,
    topRewards: [...],
    averageEarningPerUser: ...,
    conversionRate: usersWithRedemptions / totalUsers
  };
}

async function getRewardAnalytics(rewardId) {
  return {
    redemptionsLastWeek: count,
    inventoryTurnover: redeemed / stock,
    profitability: revenue - cost,
    popularityRank: position in top N
  };
}

async function getCampaignPerformance(campaignId) {
  return {
    pointsIssued: total points from campaign,
    pointsRedeemed: how many redeemed,
    userEngagement: unique users / eligible,
    ROI: revenue gained / cost to run
  };
}
```

**Route needed:**
```javascript
// backend/routes/analytics.js (NEW or add to admin.js)
router.get('/merchant/:merchantId', authenticateMerchant, async (req, res) => {
  const analytics = await analyticsService.getMerchantAnalytics(req.merchant.id);
  res.json({success: true, data: analytics});
});
```

---

## Implementation Roadmap

### Week 1: Point Earning
- [ ] Create earningService.js
- [ ] Create database migration for earnings table
- [ ] Add POST /api/rewards/earn endpoint
- [ ] Add unit tests
- [ ] Deploy & test with POS systems

### Week 2: Point Expiration
- [ ] Add expires_at column to point_transactions
- [ ] Create expirationService.js
- [ ] Implement scheduler in server.js
- [ ] Add email templates
- [ ] Add expiration to emailService.js
- [ ] Test expiration logic

### Week 3-4: Tier System
- [ ] Create tiers and tier_history tables
- [ ] Create tierService.js
- [ ] Update earningService to apply tier multipliers
- [ ] Create tier routes
- [ ] Update leaderboard to show tiers
- [ ] Add tier notification emails
- [ ] Test tier transitions

### Week 5: Analytics
- [ ] Create analyticsService.js
- [ ] Create analytics routes
- [ ] Add dashboard queries
- [ ] Create admin reports
- [ ] Test with real data

---

## Code Examples

### Example 1: Adding Point Earning

**File: novaRewards/backend/db/earning-transaction.sql**
```sql
CREATE TABLE IF NOT EXISTS earning_transactions (
  id              SERIAL PRIMARY KEY,
  user_id         INTEGER NOT NULL REFERENCES users(id),
  amount          NUMERIC(18,7) NOT NULL,
  campaign_id     INTEGER NOT NULL REFERENCES campaigns(id),
  merchant_id     INTEGER NOT NULL REFERENCES merchants(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

**File: novaRewards/backend/services/earningService.js**
```javascript
const { query } = require('../db/index');
const { getCampaignById } = require('../db/campaignRepository');
const { recordPointTransaction } = require('../db/pointTransactionRepository');

async function calculateAndRecordEarning({
  userId,
  transactionAmount,
  campaignId,
  merchantId
}) {
  // 1. Get campaign details
  const campaign = await getCampaignById(campaignId);
  if (!campaign) {
    throw new Error('Campaign not found');
  }
  
  // 2. Calculate points
  const basePoints = transactionAmount * campaign.reward_rate;
  
  // 3. TODO: Apply tier multiplier (when tier system ready)
  // const userTier = await tierService.calculateUserTier(userId);
  // const multiplier = tierService.getTierMultiplier(userTier.id, 'earning');
  // const finalPoints = basePoints * multiplier;
  
  const finalPoints = basePoints;
  
  // 4. Record point transaction
  const pointTx = await recordPointTransaction({
    userId,
    type: 'earned',
    amount: Math.round(finalPoints * 100) / 100,  // Round to 2 decimals
    campaignId,
    description: `Earned from purchase ($${transactionAmount}) at campaign "${campaign.name}"`
  });
  
  // 5. Record in earnings audit log
  await query(
    `INSERT INTO earning_transactions (user_id, amount, campaign_id, merchant_id)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [userId, finalPoints, campaignId, merchantId]
  );
  
  return {
    success: true,
    pointsEarned: finalPoints,
    pointTransaction: pointTx
  };
}

module.exports = { calculateAndRecordEarning };
```

**File: novaRewards/backend/routes/rewards.js (add)**
```javascript
// Add to existing rewards router

/**
 * POST /api/rewards/earn
 * Merchant reports a purchase and customer earns points
 * Authentication: Merchant API key
 */
router.post('/earn', authenticateMerchant, async (req, res, next) => {
  try {
    const { userId, transactionAmount, campaignId } = req.body;
    
    // Validation
    if (!userId || !transactionAmount || !campaignId) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields'
      });
    }
    
    if (transactionAmount <= 0) {
      return res.status(400).json({
        success: false,
        error: 'Transaction amount must be positive'
      });
    }
    
    // Verify campaign belongs to this merchant
    const campaign = await getCampaignById(campaignId);
    if (!campaign || campaign.merchant_id !== req.merchant.id) {
      return res.status(403).json({
        success: false,
        error: 'Campaign not found or does not belong to merchant'
      });
    }
    
    // Record earning
    const result = await earningService.calculateAndRecordEarning({
      userId,
      transactionAmount,
      campaignId,
      merchantId: req.merchant.id
    });
    
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});
```

---

### Example 2: Implementing Tier Multiplier in Earning

**After tier system is built:**

```javascript
// In earningService.js, modify calculateAndRecordEarning:

async function calculateAndRecordEarning({
  userId,
  transactionAmount,
  campaignId,
  merchantId
}) {
  const campaign = await getCampaignById(campaignId);
  if (!campaign) throw new Error('Campaign not found');
  
  const basePoints = transactionAmount * campaign.reward_rate;
  
  // NEW: Get user tier and apply multiplier
  const userTier = await tierService.calculateUserTier(userId);
  const multiplier = tierService.getTierMultiplier(userTier.id, 'earning');
  const finalPoints = basePoints * multiplier;
  
  // Continue with recording...
  const pointTx = await recordPointTransaction({
    userId,
    type: 'earned',
    amount: Math.round(finalPoints * 100) / 100,
    campaignId,
    description: `Earned from purchase ($${transactionAmount}) at campaign "${campaign.name}" (${userTier.name} tier x${multiplier})`
  });
  
  // Call tier update check
  await tierService.maybeUpdateUserTier(userId);
  
  return {
    success: true,
    pointsEarned: finalPoints,
    userTier: userTier.name,
    tierMultiplier: multiplier,
    pointTransaction: pointTx
  };
}
```

---

## Database Schema Summary

### Current Tables ✅
```
users
├── id, wallet_address, email, role, is_deleted
├── first_name, last_name, bio, last_login_at
├── referred_by (referrer's user ID)
└── referral_bonus_claimed

campaigns
├── id, merchant_id, name, reward_rate
├── start_date, end_date, is_active
└── created_at

rewards
├── id, name, cost (points), stock, is_active, is_deleted
└── created_at, updated_at

point_transactions
├── id, user_id, type ('earned'|'redeemed'|'expired'|'bonus'|'referral')
├── amount, balance_before, balance_after
├── campaign_id, referred_user_id, description
└── created_at

redemptions
├── id, user_id, reward_id, points_spent
├── idempotency_key (UNIQUE), status, point_tx_id
└── created_at

user_balance (synced via trigger)
├── user_id (PRIMARY KEY), balance, updated_at
```

### Recommended Additions ⚠️
```
tiers (NEW)
├── id, name (UNIQUE), min_points, earning_multiplier, redemption_multiplier
└── created_at

tier_history (NEW)
├── id, user_id, from_tier_id, to_tier_id, created_at

earning_transactions (NEW)
├── id, user_id, amount, campaign_id, merchant_id
└── created_at
```

---

## Testing Checklist

### Point Earning
- [ ] Test successful point earning
- [ ] Test with various transaction amounts
- [ ] Test with various reward rates
- [ ] Test concurrent earning requests
- [ ] Test tier multipliers (future)
- [ ] Test balance updates

### Point Expiration
- [ ] Test expiration of 1-year-old points
- [ ] Test no expiration of recent points
- [ ] Test multiple users simultaneously
- [ ] Test scheduler runs on schedule
- [ ] Test email notifications

### Tier System
- [ ] Test tier calculation threshold
- [ ] Test tier upgrade notifications
- [ ] Test tier multiplier application
- [ ] Test downgrade after inactivity
- [ ] Test tier history tracking

---

## Deployment Checklist

Before deploying each feature:

- [ ] All tests passing
- [ ] Database migrations tested locally
- [ ] Environment variables configured
- [ ] Rollback plan documented
- [ ] Monitoring/logging added
- [ ] Stakeholder approval
- [ ] Stage environment validation
- [ ] Performance testing complete

---

## Related Documentation

See `CODEBASE_ANALYSIS.md` for:
- Detailed analysis of existing implementation
- Database schema documentation
- API route specifications
- Smart contract details
- Architecture diagrams

