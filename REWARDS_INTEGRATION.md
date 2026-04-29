# Rewards Business Logic - Integration Guide

## Quick Start Checklist

### Step 1: Run Database Migrations
```bash
# Apply new migrations
npm run migrate

# Or manually:
# psql -f novaRewards/database/016_create_tiers.sql
# psql -f novaRewards/database/017_add_expiration_tracking.sql
```

### Step 2: Register Routes in Server
```javascript
// backend/server.js

// Add these imports
const tierRoutes = require('./routes/tiers');

// Register routes
app.use('/api/tiers', tierRoutes);
// rewarding route already exists: app.use('/api/rewards', rewardsRoutes);
```

### Step 3: Update Backend Package.json (if needed)
```json
{
  "dependencies": {
    "express-rate-limit": "^6.x.x"  // Already listed
  }
}
```

### Step 4: Create Daily Expiration Job
```javascript
// backend/jobs/expirationJob.js

const { markExpiredPoints } = require('../services/expirationService');
const cron = require('node-cron');

// Run daily at midnight
cron.schedule('0 0 * * *', async () => {
  try {
    console.log('Running daily expiration check...');
    const result = await markExpiredPoints();
    console.log(`Expired ${result.expiredCount} point transactions`);
  } catch (err) {
    console.error('Expiration job failed:', err);
  }
});
```

### Step 5: Test Integration
```bash
# Run test suites
npm test -- backend/tests/earningService.test.js
npm test -- backend/tests/tierService.test.js
npm test -- backend/tests/eligibilityService.test.js
npm test -- backend/tests/expirationService.test.js

# Test API endpoints with curl
curl -X GET http://localhost:3000/api/tiers
curl -X GET http://localhost:3000/api/tiers/user/current \
  -H "Authorization: Bearer YOUR_TOKEN"
```

---

## Usage Examples

### Example 1: User Earns Points from Purchase

```javascript
// When merchant reports a $50 purchase
const result = await recordPointEarning({
  userId: 123,
  transactionAmount: 50,
  campaignId: 1,
  campaignRewardRate: 2.0,  // 2 points per dollar
  transactionId: 'order_456'
});

// If user is Bronze (1.0x multiplier): 50 * 2.0 * 1.0 = 100 points
// If user is Silver (1.1x multiplier): 50 * 2.0 * 1.1 = 110 points
// If user is Gold (1.25x multiplier): 50 * 2.0 * 1.25 = 125 points

console.log(`User earned ${result.pointsEarned} points`);
console.log(`Expires in ${result.expirationDays} days`);
console.log(`Tier update: ${result.tierUpdate.changed ? 'PROMOTED' : 'NO CHANGE'}`);
```

### Example 2: Check Redemption Eligibility

```javascript
// User wants to redeem a $25 gift card
const eligibility = await validateRedemptionEligibility(userId, rewardId);

if (eligibility.eligible) {
  // Proceed with redemption
  const redemption = await redeemReward({ userId, rewardId });
} else {
  // Show reason to user
  switch (eligibility.reason) {
    case 'INSUFFICIENT_POINTS':
      console.log(`You need ${eligibility.details.shortfall} more points`);
      break;
    case 'INSUFFICIENT_TIER':
      console.log(`You need to reach ${eligibility.details.requiredTier} tier`);
      break;
    case 'REWARD_OUT_OF_STOCK':
      console.log('This reward is currently out of stock');
      break;
  }
}
```

### Example 3: Display Tier Progress to User

```javascript
const tierInfo = await getUserTierInfo(userId);

console.log(`Current Tier: ${tierInfo.currentTier}`);
console.log(`Total Points: ${tierInfo.totalPoints}`);
console.log(`Earning Multiplier: ${tierInfo.multipliers.earning}x`);
console.log(`Redemption Multiplier: ${tierInfo.multipliers.redemption}x`);

if (!tierInfo.tierProgress.isMaxTier) {
  console.log(
    `${tierInfo.tierProgress.pointsNeeded} points to ${tierInfo.tierProgress.nextTier} tier`
  );
}
```

### Example 4: Warn About Expiring Points

```javascript
// Check for points expiring in next 14 days
const warning = await getExpiringPointsWarning(userId, 14);

if (warning.expiringPointsCount > 0) {
  const userEmail = user.email;
  await emailService.send({
    to: userEmail,
    subject: '⏰ Your reward points are about to expire!',
    body: `You have ${warning.totalPointsAtRisk} points expiring soon. 
           Use them now to redeem awesome rewards!`
  });
}
```

### Example 5: Display Tier Progression Dashboard

```javascript
// Get all tiers with user progress
const tiersWithProgress = await getTiersWithUserProgress(userId);
const tierHistory = await getTierProgressHistory(userId, 10);

const dashboard = {
  currentTier: tierInfo.currentTier,
  totalPoints: tierInfo.totalPoints,
  tiers: tiersWithProgress.map(tier => ({
    name: tier.name,
    reached: tier.isReachable,
    current: tier.userCurrentTier,
    multiplier: tier.earning_multiplier,
    pointsToReach: tier.pointsToReach,
  })),
  history: tierHistory.map(entry => ({
    date: entry.created_at,
    from: entry.from_tier_name,
    to: entry.to_tier_name,
    reason: entry.reason,
  })),
};
```

---

## Common Integration Points

### In Purchase/Order Processing

```javascript
// After successful purchase
const earningResult = await recordPointEarning({
  userId: purchaseRecord.userId,
  transactionAmount: purchaseRecord.total,
  campaignId: merchant.activeCampaignId,
  campaignRewardRate: campaign.reward_rate,
  transactionId: purchaseRecord.id,
  description: `Purchase: ${purchaseRecord.orderNumber}`
});

if (earningResult.tierUpdate.changed) {
  // Send promotion notification
  emitter.emit('user.tier.promoted', {
    userId,
    newTier: earningResult.tierUpdate.tierName,
    bonusMultiplier: earningResult.tierUpdate.tierId
  });
}
```

### In Redemption Flow

```javascript
// Before allowing redemption
const eligibility = await validateRedemptionEligibility(userId, rewardId);

if (!eligibility.eligible) {
  const activeBalance = await calculateActiveBalance(userId);
  
  if (eligibility.reason === 'INSUFFICIENT_POINTS') {
    // Show "nearly there" message
    const summary = await getRedemptionEligibilitySummary(userId);
    return res.status(409).json({
      error: 'INSUFFICIENT_POINTS',
      userPoints: activeBalance,
      nearbyRewards: summary.nearbyRewards // Show what they can almost afford
    });
  }
}

// Proceed with redemption (existing code)
```

### In User Dashboard

```javascript
// Get everything needed for dashboard
const tierInfo = await getUserTierInfo(userId);
const earningStats = await getUserEarningStats(userId);
const expirationStats = await getUserExpirationStats(userId);

const dashboard = {
  points: {
    total: tierInfo.totalPoints,
    active: expirationStats.activePoints,
    expired: expirationStats.expiredPoints,
  },
  tier: {
    name: tierInfo.currentTier,
    multipliers: tierInfo.multipliers,
    progress: tierInfo.tierProgress,
  },
  activity: {
    earnedFromTransactions: earningStats.earned,
    earnedFromBonuses: earningStats.bonus,
    earnedFromReferrals: earningStats.referral,
    transactionCount: earningStats.earned
  },
  expiration: {
    nextExpiryDate: expirationStats.nextExpiryDate,
    pointsAtRisk: expirationStats.activePoints,
    timeline: await getExpirationTimeline(userId)
  }
};
```

### In Admin Reports

```javascript
// Generate rewards analytics
async function getRewardsAnalytics(dateRange) {
  const earning = await query(`
    SELECT
      COUNT(*) as transaction_count,
      SUM(amount) as total_points,
      AVG(amount) as avg_points
    FROM point_transactions
    WHERE type = 'earned'
    AND created_at BETWEEN $1 AND $2
  `, [dateRange.start, dateRange.end]);
  
  const tierDistribution = await query(`
    SELECT tier_id, COUNT(*) as user_count
    FROM users
    WHERE tier_id IS NOT NULL
    GROUP BY tier_id
  `);
  
  return {
    totalPointsDistributed: earning[0].total_points,
    averagePointsPerEarning: earning[0].avg_points,
    totalEarnings: earning[0].transaction_count,
    tierDistribution
  };
}
```

---

## Error Handling

### Validation Errors

```javascript
// Invalid input
{
  success: false,
  error: 'validation_error',
  message: 'Transaction amount must be positive',
  statusCode: 400
}
```

### Eligibility Errors

```javascript
// User not eligible
{
  success: false,
  error: 'INSUFFICIENT_POINTS',
  message: 'User is not eligible to redeem this reward',
  details: {
    userPoints: 500,
    pointsRequired: 1000,
    shortfall: 500
  },
  statusCode: 400
}
```

### Resource Errors

```javascript
// Resource not found
{
  success: false,
  error: 'CAMPAIGN_NOT_FOUND',
  message: 'Campaign does not exist',
  statusCode: 404
}
```

---

## Performance Considerations

1. **Batch Operations**
   ```javascript
   // Use batch earning for efficiency
   const results = await batchRecordEarnings([
     { userId: 1, transactionAmount: 100, campaignId: 1, campaignRewardRate: 1.5 },
     { userId: 2, transactionAmount: 50, campaignId: 1, campaignRewardRate: 1.5 },
     // ... more earnings
   ]);
   ```

2. **Indexing**
   - All critical columns indexed for fast queries
   - Indexes on: user_id, expires_at, is_expired, type

3. **Caching Opportunities**
   - Cache tier multipliers (rarely change)
   - Cache user tier info (refresh on tier update)
   - Cache active campaigns (refresh hourly)

4. **Expiration Job Optimization**
   - Run once daily at off-peak time
   - Marks expired points in bulk
   - Updates affected balances efficiently

---

## Monitoring & Alerting

### Key Metrics to Track

```javascript
// Point velocity
const earning = await query(`
  SELECT DATE(created_at), SUM(amount)
  FROM point_transactions
  WHERE type = 'earned'
  GROUP BY DATE(created_at)
  ORDER BY DATE(created_at) DESC
  LIMIT 30
`);

// Expiration rate
const expired = await markExpiredPoints();
console.log(`${expired.expiredCount} transactions expired today`);

// Tier distribution
const tiers = await query(`
  SELECT t.name, COUNT(u.id) as user_count
  FROM tiers t
  LEFT JOIN users u ON u.tier_id = t.id
  GROUP BY t.id
`);

// Redemption vs earning ratio
const ratio = await query(`
  SELECT
    (SELECT SUM(amount) FROM point_transactions WHERE type = 'earned') as earned,
    (SELECT SUM(amount) FROM point_transactions WHERE type = 'redeemed') as redeemed
`);
```

---

## Support & Debugging

### Enable Debug Logging

```javascript
// In earningService.js
const DEBUG = process.env.DEBUG_REWARDS === 'true';

function log(message, data) {
  if (DEBUG) {
    console.log(`[REWARDS] ${message}`, data);
  }
}
```

### Test Individual Functions

```bash
# Test earning calculation
node -e "
  const { calculatePointsEarned } = require('./backend/services/earningService');
  calculatePointsEarned(100, 1.5, 1).then(console.log);
"

# Test tier determination
node -e "
  const { determineTierByPoints } = require('./backend/db/tierRepository');
  determineTierByPoints(2500).then(t => console.log(t.name));
"
```

---

## Deployment Checklist

- [ ] Run all database migrations
- [ ] Register tier routes in server.js
- [ ] Set up daily expiration cron job
- [ ] Configure environment variables (if needed)
- [ ] Run full test suite
- [ ] Test API endpoints manually
- [ ] Deploy to staging
- [ ] Verify tier system with test data
- [ ] Monitor for errors in production
- [ ] Update frontend with new API endpoints

