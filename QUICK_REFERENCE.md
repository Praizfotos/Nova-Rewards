# Rewards System - Quick Reference Guide

## TL;DR - Key Concepts

### Points Flow
```
Transaction → Earning Service → Calculate (amount × rate × tier multiplier)
→ Set Expiration → Record in DB → Check Tier Threshold → Update Tier if Needed
```

### Tier Benefits
```
BRONZE (0-999pts)     → 1.0x earn, 1.0x redeem, 365 day expiration
SILVER (1000-4999pts) → 1.1x earn, 1.05x redeem, 730 day expiration  
GOLD (5000-9999pts)   → 1.25x earn, 1.1x redeem, 730 day expiration
PLATINUM (10000+pts)  → 1.5x earn, 1.25x redeem, 1095 day expiration
```

### Validation Gates
```
To EARN: User exists ✓ Campaign active ✓ In date range ✓ Daily limit OK ✓
To REDEEM: User exists ✓ Points enough ✓ Reward active ✓ In stock ✓ Tier OK ✓
```

---

## Common Tasks

### Record a User Earning 100 Points
```javascript
const { recordPointEarning } = require('../services/earningService');

await recordPointEarning({
  userId: 123,
  transactionAmount: 100,        // $100 spent
  campaignId: 1,
  campaignRewardRate: 1.0,       // 1 point per dollar
  transactionId: 'order_789'
});
// Result: 100 points (or more with tier multiplier)
```

### Check If User Can Redeem
```javascript
const { validateRedemptionEligibility } = require('../services/eligibilityService');

const result = await validateRedemptionEligibility(userId, rewardId);
if (result.eligible) {
  // Proceed with redemption
} else {
  console.log(result.reason);  // Why they can't redeem
  console.log(result.details); // More info (shortfall, etc)
}
```

### Get User's Tier Info
```javascript
const { getUserTierInfo } = require('../services/tierService');

const info = await getUserTierInfo(userId);
console.log(info.currentTier);                // "Silver"
console.log(info.totalPoints);                // 2500
console.log(info.multipliers.earning);        // 1.1
console.log(info.tierProgress.pointsNeeded);  // 2500 points to Gold
```

### Show User Their Point Expiration
```javascript
const { getExpiringPointsWarning } = require('../services/expirationService');

const warning = await getExpiringPointsWarning(userId, 7); // Next 7 days
console.log(warning.totalPointsAtRisk);     // How many points expiring
console.log(warning.expiredTransactions);   // Details of each expiring batch
```

### Get User's Earning History
```javascript
const { getUserEarningHistory } = require('../services/earningService');

const history = await getUserEarningHistory(userId, 50); // Last 50 earnings
history.forEach(tx => {
  console.log(tx.amount, tx.type, tx.description, tx.expires_at);
});
```

### Auto-Update User Tier
```javascript
const { maybeUpdateUserTier } = require('../services/tierService');

const result = await maybeUpdateUserTier(userId);
if (result.changed) {
  console.log(`Promoted to ${result.tierName}`);
  emitter.emit('tier.upgraded', { userId, newTier: result.tierName });
}
```

### Mark Today's Expired Points (Daily Job)
```javascript
const { markExpiredPoints } = require('../services/expirationService');

const result = await markExpiredPoints();
console.log(`Marked ${result.expiredCount} transactions as expired`);
```

---

## API Endpoints Quick Reference

### Earn Points
```
POST /api/rewards/earn
Authorization: Merchant

Body: {
  userId: 1,
  transactionAmount: 100,
  campaignId: 1,
  transactionId?: "tx123",
  description?: "Purchase"
}

Response: { pointsEarned, expiresAt, tierUpdate }
```

### Get User's Earning History
```
GET /api/rewards/earning-history?limit=50
Authorization: User

Response: { earningHistory: [...], count: 50 }
```

### Get User's Tier
```
GET /api/tiers/user/current
Authorization: User

Response: {
  currentTier: "Silver",
  totalPoints: 2500,
  tierProgress: { nextTier: "Gold", pointsNeeded: 2500 },
  multipliers: { earning: 1.1, redemption: 1.05 }
}
```

### Get All Tiers
```
GET /api/tiers

Response: [
  { name: "Bronze", minPoints: 0, earning: 1.0, redemption: 1.0 },
  { name: "Silver", minPoints: 1000, earning: 1.1, redemption: 1.05 },
  ...
]
```

---

## Common Scenarios

### Scenario 1: User makes $50 purchase, is Bronze tier
```
Input: transactionAmount=$50, rate=2.0 (2pts/$), tier multiplier=1.0
Calculation: 50 × 2.0 × 1.0 = 100 points
Expiration: 365 days from now
Tier check: 100 total points - still Bronze (need 1000 for Silver)
Output: User gets 100 points, Bronze tier unchanged
```

### Scenario 2: User makes $2500 purchase, is Bronze, crosses Silver threshold  
```
Input: transactionAmount=$2500, rate=1.0, tier=Bronze (1.0x)
Calculation: 2500 × 1.0 × 1.0 = 2500 points
New total: 2500 points
Tier check: Now qualifies for Silver tier!
Output: User gets 2500 points, promoted to Silver
  - Future earnings will use 1.1x multiplier
  - New points expire in 730 days instead of 365
```

### Scenario 3: User tries to redeem Gold reward, is Silver
```
Validation:
- User exists? ✓
- Has 5000 points? ✓ (only 2500, X)
Result: INSUFFICIENT_POINTS
Response: "You need 2500 more points" or show nearby rewards they CAN afford
```

### Scenario 4: Points expiring in 3 days
```
Schedule: Daily job runs at midnight
Check: Any points with expires_at <= NOW() + 1 day?
Action: Mark is_expired = TRUE, update user_balance
Result: Points removed from active balance, appear in "expired" category
```

---

## Code Patterns

### Using Earning Service
```javascript
const { recordPointEarning } = require('../services/earningService');

try {
  const result = await recordPointEarning({
    userId,
    transactionAmount,
    campaignId,
    campaignRewardRate,
  });
  
  return res.json({
    pointsEarned: result.pointsEarned,
    tierUpdated: result.tierUpdate.changed
  });
} catch (err) {
  return res.status(500).json({ error: err.message });
}
```

### Using Eligibility Service  
```javascript
const { validateRedemptionEligibility } = require('../services/eligibilityService');

const eligibility = await validateRedemptionEligibility(userId, rewardId);

if (!eligibility.eligible) {
  return res.status(409).json({
    error: eligibility.reason,
    details: eligibility.details
  });
}

// Proceed with redemption...
```

### Using Tier Service
```javascript
const { getUserTierInfo, getTiersWithUserProgress } = require('../services/tierService');

const tierInfo = await getUserTierInfo(userId);
const tiers = await getTiersWithUserProgress(userId);

// Display on dashboard
res.json({
  currentTier: tierInfo.currentTier,
  progress: tierInfo.tierProgress,
  allTiers: tiers
});
```

---

## Error Codes

| Code | Meaning | Action |
|------|---------|--------|
| USER_NOT_FOUND | User doesn't exist | Check user ID |
| CAMPAIGN_NOT_FOUND | Campaign doesn't exist | Check campaign ID |
| CAMPAIGN_INACTIVE | Campaign not active | Show campaign end date |
| CAMPAIGN_OUT_OF_DATE_RANGE | Outside campaign dates | Show campaign date range |
| DAILY_LIMIT_EXCEEDED | Hit daily earning limit | Check back tomorrow |
| REWARD_NOT_FOUND | Reward doesn't exist | Check reward ID |
| REWARD_INACTIVE | Reward not available | Show unavailable message |
| REWARD_OUT_OF_STOCK | Reward sold out | Show out of stock |
| INSUFFICIENT_POINTS | Not enough points | Show shortfall |
| INSUFFICIENT_TIER | Tier too low | Show required tier |
| validation_error | Bad input | Check request body |

---

## Database Queries

### All user earnings this month
```sql
SELECT * FROM point_transactions
WHERE user_id = $1
AND type IN ('earned', 'bonus', 'referral')
AND created_at >= DATE_TRUNC('month', NOW())
ORDER BY created_at DESC;
```

### Points expiring soon
```sql
SELECT * FROM point_transactions
WHERE user_id = $1
AND is_expired = FALSE
AND expires_at BETWEEN NOW() AND NOW() + INTERVAL '7 days'
ORDER BY expires_at ASC;
```

### User's current tier and points
```sql
SELECT u.id, u.tier_id, t.name, t.earning_multiplier,
       COALESCE(SUM(CASE WHEN type IN ('earned','bonus','referral') THEN amount ELSE -amount END), 0) as total_points
FROM users u
LEFT JOIN tiers t ON u.tier_id = t.id
LEFT JOIN point_transactions pt ON u.id = pt.user_id
WHERE u.id = $1
GROUP BY u.id, u.tier_id, t.name, t.earning_multiplier;
```

### Tier distribution
```sql
SELECT t.name, COUNT(u.id) as user_count
FROM tiers t
LEFT JOIN users u ON u.tier_id = t.id
GROUP BY t.id, t.name
ORDER BY t.min_points;
```

---

## Performance Tips

1. **Batch earnings** - Use `batchRecordEarnings()` for multiple at once
2. **Cache tiers** - Tier multipliers rarely change, cache for 1 hour
3. **Index queries** - All important columns indexed
4. **Off-peak expiration** - Run `markExpiredPoints()` at midnight
5. **User-specific queries** - Always filter by user_id first

---

## Testing Your Integration

```bash
# Run all reward tests
npm test -- backend/tests/earning*
npm test -- backend/tests/tier*
npm test -- backend/tests/eligibility*
npm test -- backend/tests/expiration*

# Test endpoints
curl http://localhost:3000/api/tiers
curl http://localhost:3000/api/tiers/user/current -H "Authorization: Bearer TOKEN"

# Check migrations applied
psql -c "SELECT COUNT(*) FROM tiers;"
```

---

## When to Use Each Service

| Service | When | Example |
|---------|------|---------|
| earningService | Recording point transactions | After purchase, referral, bonus |
| tierService | Checking/updating user tier | Dashboard display, tier promotion |
| eligibilityService | Validation before action | Pre-redemption check |
| expirationService | Expiration-related queries | Show expiration warnings, daily job |

---

## Key Functions at a Glance

```javascript
// Earning
recordPointEarning()           // Main: record earning with auto-tier update
calculatePointsEarned()         // Helper: calculate with multiplier
getUserEarningHistory()         // Get past earnings
getUserEarningStats()           // Summary statistics

// Tier
maybeUpdateUserTier()           // Main: auto-promote/demote
applyTierMultiplier()           // Helper: apply multiplier to points
getUserTierInfo()               // Get comprehensive tier info
getTiersWithUserProgress()      // Get all tiers with progress

// Eligibility
validateRedemptionEligibility() // Main: full validation
validateEarningEligibility()    // Validate earning
getRedemptionEligibilitySummary() // Summary across all rewards

// Expiration
markExpiredPoints()             // Main: daily job
getExpiringPointsWarning()      // Get expiring soon points
calculateActiveBalance()        // Get true available balance
getExpirationTimeline()         // Timeline visualization
```

---

## Need More Info?

- **Full Documentation**: See REWARDS_IMPLEMENTATION.md
- **Integration Examples**: See REWARDS_INTEGRATION.md
- **Database Schema**: Run `psql -c "\d tiers"` or check migration files
- **Test Examples**: Check backend/tests/
- **API Responses**: Check route handlers in routes/
