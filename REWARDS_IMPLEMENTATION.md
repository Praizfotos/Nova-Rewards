# Rewards Business Logic Implementation

## Overview

This document describes the complete rewards business logic implementation for Nova Rewards, including point earning, tier management, reward eligibility, and point expiration handling.

## Architecture

### Core Components

1. **Earning Service** (`earningService.js`) - Calculates and records point earnings
2. **Tier Service** (`tierService.js`) - Manages user tiers and multipliers
3. **Eligibility Service** (`eligibilityService.js`) - Validates earning and redemption eligibility
4. **Expiration Service** (`expirationService.js`) - Handles point expiration logic
5. **Database Layer** (`db/tierRepository.js`) - Tier persistence and queries

### Database Schema

#### New Tables

**tiers**
- Stores tier configurations with earning/redemption multipliers
- Default tiers: Bronze (1x), Silver (1.1x), Gold (1.25x), Platinum (1.5x)
- Each tier has configurable point range and expiration days

**tier_history**
- Audit trail of tier changes
- Records reason for tier upgrade/downgrade
- Tracks when user changes tiers

#### Extended Tables

**users**
- Added `tier_id` - Current tier ID
- Added `tier_updated_at` - Last tier update timestamp

**point_transactions**
- Added `expires_at` - When points expire
- Added `is_expired` - Flag for expired points
- Added `claimed_at` - When points were redeemed
- Added `metadata` - JSON for additional tracking data

---

## Core Features

### 1. Point Earning Calculation

```javascript
// Calculate points with tier multiplier
const pointsEarned = await calculatePointsEarned(
  transactionAmount,  // $100
  campaignRewardRate,  // 1.5 (1.5 points per dollar)
  userId               // 1
);
// Result: 150 points (or 165 if user is Silver tier with 1.1x multiplier)
```

**Formula**: `basePoints = transactionAmount × campaignRewardRate × tierMultiplier`

**Key Features:**
- Applies user's tier multiplier automatically
- Rounds to nearest integer
- Sets automatic expiration date based on tier
- Records metadata for transaction tracking
- Validates campaign eligibility before recording

### 2. Tier System

Four-tier structure with automatic promotion/demotion:

| Tier | Min Points | Earning Multiplier | Redemption Multiplier | Expiration |
|------|------------|-------------------|----------------------|------------|
| Bronze | 0 | 1.00x | 1.00x | 365 days |
| Silver | 1,000 | 1.10x | 1.05x | 730 days |
| Gold | 5,000 | 1.25x | 1.10x | 730 days |
| Platinum | 10,000 | 1.50x | 1.25x | 1,095 days |

**Auto-Promotion Logic:**
- Called automatically after each earning
- User promoted when total points cross threshold
- Changes recorded in `tier_history` table
- Tier history available for user progression tracking

**Benefits by Tier:**
- **Earning Multiplier**: Earn more points per transaction
- **Redemption Multiplier**: Spend fewer points for same reward (e.g., 100 points costs Silver user only 95 points)
- **Extended Expiration**: Higher tiers have longer point validity

### 3. Reward Eligibility Validation

Comprehensive validation before earning or redeeming:

#### Earning Eligibility Checks
- User exists
- Campaign exists and is active
- Campaign is within date range
- Daily earning limit not exceeded (optional)

#### Redemption Eligibility Checks
- User exists and has sufficient points
- Reward exists and is active
- Reward has quantity available
- User meets tier requirement (if any)

```javascript
const eligibility = await validateRedemptionEligibility(userId, rewardId);

if (!eligibility.eligible) {
  console.log(eligibility.reason); // 'INSUFFICIENT_POINTS'
  console.log(eligibility.details); // { userPoints: 500, pointsRequired: 1000, ... }
}
```

### 4. Point Expiration

Points automatically expire based on tier configuration:

**Expiration Tracking:**
- Each earning transaction gets `expires_at` timestamp
- Automatic daily job marks expired points
- Expired points don't count toward balance
- Balance update triggered when points expire

**Active Balance Calculation:**
```javascript
const activeBalance = await calculateActiveBalance(userId);
// Returns only non-expired, non-redeemed points
```

**Expiration Timeline:**
```javascript
const timeline = await getExpirationTimeline(userId);
// Returns breakdown by expiry date for user visualization
```

**Expiration Warnings:**
```javascript
const warning = await getExpiringPointsWarning(userId, 7); // 7 days
// Identify points expiring within threshold
// Useful for notification system
```

---

## API Endpoints

### Earning Points

**POST /api/rewards/earn**

Records point earning for a user based on transaction.

```javascript
Request Body:
{
  userId: 1,
  transactionAmount: 100,      // Dollar amount
  campaignId: 1,
  transactionId: "tx123",      // Optional, for tracking
  description: "Purchase at store" // Optional
}

Response:
{
  success: true,
  data: {
    pointsEarned: 150,
    expirationDays: 730,
    expiresAt: "2027-04-29T00:00:00.000Z",
    tierUpdate: {
      tierId: 2,
      tierName: "Silver",
      changed: true,
      previousTier: "Bronze"
    }
  }
}
```

### View Earning History

**GET /api/rewards/earning-history**

Retrieves past earning transactions for authenticated user.

```javascript
Query Parameters:
- limit: max results (default 50, max 200)

Response:
{
  success: true,
  data: {
    earningHistory: [
      {
        id: 1,
        type: "earned",
        amount: 150,
        description: "Purchase at store",
        expires_at: "2027-04-29T00:00:00.000Z",
        campaign_id: 1,
        created_at: "2026-04-29T10:30:00.000Z"
      }
    ],
    count: 10
  }
}
```

### View Earning Statistics

**GET /api/rewards/earning-stats**

Summary of user's earning activity.

```javascript
Response:
{
  success: true,
  data: {
    total: 5000,
    earned: 4500,
    bonus: 300,
    referral: 200,
    transactionCounts: {
      earned: 30,
      bonus: 2,
      referral: 1
    }
  }
}
```

### Tier Information

**GET /api/tiers**

List all available tiers with multipliers.

```javascript
Response:
{
  success: true,
  data: [
    {
      id: 1,
      name: "Bronze",
      minPoints: 0,
      maxPoints: 999,
      earningMultiplier: 1.00,
      redemptionMultiplier: 1.00,
      expirationDays: 365
    },
    // ... more tiers
  ]
}
```

**GET /api/tiers/user/current**

Current tier and progress for authenticated user.

```javascript
Response:
{
  success: true,
  data: {
    userId: 1,
    currentTier: "Silver",
    currentTierId: 2,
    totalPoints: 2500,
    tierProgress: {
      currentTier: "Silver",
      nextTier: "Gold",
      pointsNeeded: 2500,
      pointsUntilNextTier: 5000,
      isMaxTier: false
    },
    multipliers: {
      earning: 1.10,
      redemption: 1.05
    },
    pointExpirationDays: 730
  }
}
```

**GET /api/tiers/user/progress**

All tiers with user's progress toward each.

```javascript
Response:
{
  success: true,
  data: {
    tiers: [
      {
        id: 1,
        name: "Bronze",
        minPoints: 0,
        maxPoints: 999,
        userCurrentTier: false,
        pointsToReach: 0,
        isReachable: true,
        // ...
      },
      {
        id: 2,
        name: "Silver",
        minPoints: 1000,
        maxPoints: 4999,
        userCurrentTier: true,
        pointsToReach: 0,
        isReachable: true,
        // ...
      }
    ]
  }
}
```

**GET /api/tiers/user/history**

Tier progression history for authenticated user.

```javascript
Query Parameters:
- limit: max results (default 50, max 200)

Response:
{
  success: true,
  data: {
    tierHistory: [
      {
        id: 1,
        user_id: 1,
        from_tier_id: 1,
        to_tier_id: 2,
        from_tier_name: "Bronze",
        to_tier_name: "Silver",
        reason: "auto_tier_update",
        created_at: "2026-04-20T15:30:00.000Z"
      }
    ],
    count: 1
  }
}
```

---

## Service Methods

### Earning Service

```javascript
// Calculate points with tier multiplier
await calculatePointsEarned(transactionAmount, campaignRewardRate, userId);

// Record earning and auto-update tier
await recordPointEarning({
  userId,
  transactionAmount,
  campaignId,
  campaignRewardRate,
  transactionId,
  description
});

// Process multiple earnings in batch
await batchRecordEarnings(earningsArray);

// Get earning history
await getUserEarningHistory(userId, limit);

// Get earning statistics
await getUserEarningStats(userId);
```

### Tier Service

```javascript
// Apply tier multiplier to points
await applyTierMultiplier(basePoints, tierId, 'earning' | 'redemption');

// Auto-promote/demote based on points
await maybeUpdateUserTier(userId);

// Get comprehensive tier info
await getUserTierInfo(userId);

// Get all tiers with user progress
await getTiersWithUserProgress(userId);

// Get tier progression history
await getTierProgressHistory(userId, limit);
```

### Eligibility Service

```javascript
// Validate earning eligibility
await validateEarningEligibility(userId, campaignId);

// Validate redemption eligibility
await validateRedemptionEligibility(userId, rewardId);

// Check daily earning limit
await checkDailyEarningLimit(userId, campaignId, dailyLimit);

// Get redemption summary
await getRedemptionEligibilitySummary(userId);
```

### Expiration Service

```javascript
// Mark expired points in database
await markExpiredPoints();

// Get points expiring soon
await getExpiringPointsWarning(userId, daysUntilExpiry);

// Get expiration statistics
await getUserExpirationStats(userId);

// Get recently expired points
await getUserExpirationHistory(userId, limit);

// Calculate active balance (excluding expired)
await calculateActiveBalance(userId);

// Get expiration timeline
await getExpirationTimeline(userId);

// Update expiration dates for tier change
await updateExpirationForTierChange(userId, newTierId);
```

---

## Integration with Existing Systems

### Redemption Integration

When a user redeems a reward:

```javascript
// Apply tier multiplier to redemption cost
const tierMultiplier = tierService.getTierMultiplier(user.tier_id, 'redemption');
const actualCost = rewardPointsCost * tierMultiplier;

// Validate sufficient active (non-expired) points
const activeBalance = await expirationService.calculateActiveBalance(userId);
if (activeBalance < actualCost) {
  return error('INSUFFICIENT_POINTS');
}

// Record redemption debit
await recordPointTransaction({
  userId,
  type: 'redeemed',
  amount: actualCost,
  rewardId,
  description: `Redeemed ${reward.name}`
});
```

### Referral Integration

Referral bonuses apply tier multiplier:

```javascript
// Award referral bonus with tier multiplier
const tierMultiplier = await tierService.applyTierMultiplier(
  REFERRAL_BONUS_POINTS,
  referrerTier,
  'earning'
);

await recordPointTransaction({
  userId: referrerId,
  type: 'referral',
  amount: tierMultiplier,
  referredUserId,
  description: 'Referral bonus'
});
```

### Daily Bonus Integration

Daily login bonuses respect expiration:

```javascript
const expirationDays = await tierService.getExpirationDaysForTier(user.tier_id);
const expiresAt = new Date();
expiresAt.setDate(expiresAt.getDate() + expirationDays);

await recordPointTransaction({
  userId,
  type: 'bonus',
  amount: DAILY_BONUS_POINTS,
  description: 'Daily login bonus',
  // expires_at will be set by update query
});
```

---

## Database Migrations

Two new migrations required:

1. **016_create_tiers.sql** - Creates tier system
2. **017_add_expiration_tracking.sql** - Adds expiration fields

Run migrations:
```bash
npm run migrate
```

---

## Testing

Comprehensive test suites included:

- `earningService.test.js` - Point calculation and recording
- `tierService.test.js` - Tier promotion and multipliers
- `eligibilityService.test.js` - Validation logic
- `expirationService.test.js` - Point expiration

Run tests:
```bash
npm test -- backend/tests/earningService.test.js
npm test -- backend/tests/tierService.test.js
npm test -- backend/tests/eligibilityService.test.js
npm test -- backend/tests/expirationService.test.js
```

---

## Configuration

Default values can be customized in `services/configService.js`:

```javascript
module.exports = {
  // Tier multipliers
  TIER_MULTIPLIERS: {
    BRONZE: { earning: 1.0, redemption: 1.0 },
    SILVER: { earning: 1.1, redemption: 1.05 },
    GOLD: { earning: 1.25, redemption: 1.1 },
    PLATINUM: { earning: 1.5, redemption: 1.25 },
  },
  
  // Point expiration (days)
  POINT_EXPIRATION_DAYS: 365,
  
  // Daily earning limit (null = no limit)
  DAILY_EARNING_LIMIT: null,
  
  // Referral bonus points
  REFERRAL_BONUS_POINTS: 100,
};
```

---

## Security Considerations

1. **Rate Limiting** - Earning endpoint uses rate limiter (20 req/min)
2. **Authentication** - All user-specific endpoints require authentication
3. **Authorization** - Users can only access their own data
4. **Validation** - All inputs validated before processing
5. **Atomicity** - Point transactions use database locks to prevent race conditions
6. **Audit Trail** - All tier changes recorded in history

---

## Future Enhancements

1. **Tiered Campaigns** - Different earning rates by tier
2. **Seasonal Bonuses** - Temporary multiplier campaigns
3. **Achievement Badges** - Unlock special tiers through actions
4. **Point Pools** - Family or group point sharing
5. **Expiration Rules** - Different expiration by transaction type
6. **Dynamic Tiers** - Admin-configurable tier system

---

## Troubleshooting

### User tier not updating
- Verify `maybeUpdateUserTier()` called after earning
- Check tier thresholds in database
- Confirm `tier_id` field exists on users table

### Points showing incorrect expiration
- Run `markExpiredPoints()` daily via cron job
- Verify tier expiration_days values
- Check point transaction metadata

### Eligibility validation failing
- Ensure campaign is active and within date range
- Verify user exists in database
- Check campaign belongs to merchant

### Balance calculation incorrect
- Use `calculateActiveBalance()` instead of `user_balance`
- Ensure expired points marked via `markExpiredPoints()`
- Verify no orphaned transactions

