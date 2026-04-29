# Nova Rewards Codebase Analysis

**Analysis Date**: April 28, 2026  
**Status**: Comprehensive review of rewards system implementation

---

## Executive Summary

The Nova Rewards system has a **solid foundation** with well-structured database schemas, atomic redemption logic, and merchant campaign management. However, several critical features are **incomplete or missing**, particularly around automatic point earning, tier systems, and reward calculation automation.

### Current State: ⚠️ 60% Complete
- ✅ Database schema robust
- ✅ Redemption system atomic & idempotent
- ✅ Blockchain integration (Stellar/Soroban)
- ⚠️ Point earning logic incomplete
- ❌ Tier system not implemented
- ❌ Automatic point expiration not implemented
- ❌ Analytics/reporting minimal

---

## 1. DATABASE SCHEMA ANALYSIS

### Core Tables (Well-Designed)

#### **Rewards & Points**
```sql
-- Inventory of redeemable rewards
CREATE TABLE rewards (
  id              SERIAL PRIMARY KEY,
  name            VARCHAR(255) NOT NULL,
  cost            NUMERIC(18,2) NOT NULL,     -- Points cost
  stock           INTEGER DEFAULT 0,          -- Remaining inventory
  is_active       BOOLEAN DEFAULT TRUE,
  is_deleted      BOOLEAN DEFAULT FALSE,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Running user point balance (synced via trigger)
CREATE TABLE user_balance (
  user_id         INTEGER PRIMARY KEY,
  balance         INTEGER NOT NULL DEFAULT 0 CHECK (balance >= 0),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Immutable audit log of all point movements
CREATE TABLE point_transactions (
  id              SERIAL PRIMARY KEY,
  user_id         INTEGER NOT NULL REFERENCES users(id),
  type            VARCHAR(20) CHECK (type IN ('earned','redeemed','expired','bonus','referral')),
  amount          NUMERIC(18,2) NOT NULL,
  balance_before  INTEGER,
  balance_after   INTEGER,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  -- Composite index for leaderboard aggregation
  INDEX (user_id, created_at)
);

-- Permanent redemption audit trail with idempotency
CREATE TABLE redemptions (
  id              SERIAL PRIMARY KEY,
  user_id         INTEGER NOT NULL REFERENCES users(id),
  reward_id       INTEGER NOT NULL REFERENCES rewards(id),
  points_spent    INTEGER NOT NULL,
  idempotency_key VARCHAR(255) NOT NULL UNIQUE,
  status          VARCHAR(20) DEFAULT 'completed',
  point_tx_id     INTEGER REFERENCES point_transactions(id),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  -- Indexes for query efficiency
  INDEX (user_id, created_at),
  INDEX (idempotency_key)
);
```

**Design Strengths:**
- ✅ Atomic trigger maintains user_balance in sync
- ✅ Idempotency keys prevent duplicate redemptions
- ✅ Immutable audit trail (point_transactions)
- ✅ Soft-delete support on rewards
- ✅ Proper constraint checking (balance >= 0, stock >= 0)

#### **Campaign & Merchant**
```sql
CREATE TABLE campaigns (
  id          SERIAL PRIMARY KEY,
  merchant_id INTEGER NOT NULL REFERENCES merchants(id),
  name        VARCHAR(255) NOT NULL,
  reward_rate NUMERIC(18,7) NOT NULL,    -- e.g., 0.05 for 5% cashback
  start_date  DATE NOT NULL,
  end_date    DATE NOT NULL CHECK (end_date > start_date),
  is_active   BOOLEAN DEFAULT TRUE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE merchants (
  id            SERIAL PRIMARY KEY,
  name          VARCHAR(255) NOT NULL,
  wallet_address VARCHAR(56) NOT NULL UNIQUE,  -- Stellar address
  api_key       VARCHAR(64) NOT NULL UNIQUE,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);
```

**Tracking:**
- Campaigns linked to merchants
- Reward rates stored as NUMERIC for precision
- Date validation at DB level

### Engagement Features

#### **Referral System**
```sql
-- In users table:
ALTER TABLE users ADD COLUMN referred_by INTEGER REFERENCES users(id);
ALTER TABLE users ADD COLUMN referral_bonus_claimed BOOLEAN DEFAULT FALSE;
```

#### **Login Bonus**
```sql
ALTER TABLE users ADD COLUMN last_login_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN daily_bonus_granted_at TIMESTAMPTZ;
```

#### **Drops/Airdrops**
```sql
CREATE TABLE drops (
  id            SERIAL PRIMARY KEY,
  name          VARCHAR(255),
  points        INTEGER,
  merkle_root   VARCHAR(64),              -- For whitelist verification
  claim_limit   INTEGER,
  claimed_count INTEGER DEFAULT 0,
  -- Eligibility criteria
  ...
);
```

### GAPS IN SCHEMA

| Gap | Impact | Priority |
|-----|--------|----------|
| **No tiers table** | Can't implement tier-based rewards | HIGH |
| **No point expiration tracking** | Can't automatically expire old points | HIGH |
| **No reward calculation log** | No audit trail for point earning | MEDIUM |
| **No tier history** | Can't track user tier progression | MEDIUM |
| **Limited analytics columns** | Difficulty reporting on trends | LOW |

---

## 2. SERVICE LAYER IMPLEMENTATION

### Implemented Services

#### **Referral Service** ✅
**File**: `novaRewards/backend/services/referralService.js`

```javascript
// Core functions:
processReferralBonus(referrerId, referredUserId)
  → Verify referral relationship
  → Record point transaction
  → Mark bonus claimed

getUserReferralStats(userId)
  → Get referred users list
  → Calculate total referral points
  → Return referral count
```

**Validations:**
- Prevents self-referrals
- Checks if bonus already claimed
- Verifies user existence
- Validates referral relationship

#### **Email Service** ✅
**File**: `novaRewards/backend/services/redemptionEventListener.js`

```javascript
registerRedemptionEventListener()
  → Listens for 'redemption.created' events
  → Sends confirmation email with:
    - User name
    - Reward name
    - Points spent
    - Redemption ID
```

**Features:**
- Fire-and-forget pattern (failures don't block redemption)
- Only sends if email exists
- Error logging

#### **Drop Service** ⚠️ Partial
**File**: `novaRewards/backend/services/dropService.js`

```javascript
getEligibleDrops(user)
  → Determine user's eligibility
  → Return active drops user can claim

processClaim(drop, user, proof, events)
  → Verify Merkle proof (if required)
  → Record claim
  → Emit event
  → Handle Merkle tree validation
```

**Status**: Partially implemented, needs testing

#### **Token Service** ✅
**File**: `novaRewards/backend/services/tokenService.js`

```javascript
signAccessToken(payload)  // 15m expiry
signRefreshToken(payload) // 7d expiry
verifyToken(token)
```

### NOT YET IMPLEMENTED - MAJOR GAPS

#### **Missing: Reward Earning Service**
```javascript
// What's missing:
calculateEarnings(transactionAmount, campaignRewardRate, userTier?)
  → Apply reward rate to transaction amount
  → Factor in user tier multiplier (if exists)
  → Return points earned

recordEarning(userId, transactionId, campaignId, pointsEarned)
  → Create point transaction of type 'earned'
  → Update user balance
  → Emit earning.created event

getAvailableRewards(userId)
  → Show user what rewards they can redeem
  → Show point cost vs balance
  → Show inventory status
```

**Impact**: **CRITICAL** - No way for customers to earn points automatically

#### **Missing: Tier System Service**
```javascript
// Not implemented:
calculateUserTier(userId, totalPoints, totalSpending)
  → Determine user tier (Bronze, Silver, Gold, Platinum)
  → Apply tier multipliers
  → Return tier details and benefits

getNextTierThreshold(currentTier)
  → Show points needed to reach next tier
  → Show time to downgrade

applyTierMultiplier(basePoints, userTier)
  → Apply tier-specific earning multiplier
  → e.g., Gold tier = 1.25x multiplier
```

**Impact**: Cannot implement tiered rewards

#### **Missing: Point Expiration Service**
```javascript
// Not implemented:
expireOldPoints()
  → Query point_transactions for 'earned' type older than X days
  → Create 'expired' transactions
  → Update user_balance

scheduleExpirationCheck()
  → Cron job to run daily/weekly
```

**Impact**: Old points never expire (could cause liability)

#### **Missing: Analytics Service**
```javascript
// Missing metrics:
getMerchantAnalytics(merchantId, dateRange)
  → Total distributed
  → Total redeemed
  → Redemption rate
  → Top rewards
  → Customer acquisition cost

getRewardAnalytics(rewardId)
  → Redemptions per week
  → Inventory turnover
  → Profitability

getUserAnalytics(userId)
  → Points earned vs redeemed
  → Tier progression
  → Favorite rewards
```

---

## 3. API ROUTES ANALYSIS

### Rewards Distribution (Merchant)
**Route**: `POST /api/rewards/distribute`  
**Auth**: Merchant API key  
**Rate limit**: 20 req/min

```javascript
Request:
{
  walletAddress: "GXXXXXX",
  amount: 100.5,
  campaignId: 5
}

Process:
1. Verify trustline exists
2. Validate campaign (active, not expired, merchant owns it)
3. Call blockchain distributeRewards()
4. Record transaction in DB

Response:
{
  success: true,
  txHash: "...",
  transaction: { ... }
}
```

**Issues**:
- ⚠️ Points not automatically recorded from this
- ⚠️ No link between distributed NOVA tokens and point earning
- ⚠️ Manual process for point assignment

### Redemptions (User)
**Route**: `POST /api/redemptions`  
**Auth**: User JWT  
**Idempotency**: Required header

```javascript
// Atomic redemption flow:
1. Check idempotency key (prevent duplicates)
2. Lock reward row for update
3. Verify reward is active, in-stock
4. Lock user_balance row
5. Verify sufficient points
6. Decrement stock
7. Create point_transaction of type 'redeemed'
8. Record redemption audit row
9. Emit event for email

Response on idempotent replay: 200 (not 201)
```

**Quality**: ✅ Well-implemented

### Leaderboard
**Route**: `GET /api/leaderboard?period=weekly|alltime&limit=50`  
**Auth**: User JWT  
**Cache**: Redis 5 min TTL

```javascript
// Query:
SELECT user_id, SUM(amount) as total_points, rank
FROM point_transactions
WHERE type = 'earned' AND created_at >= period_start
GROUP BY user_id
ORDER BY total_points DESC
LIMIT 50

// Plus current user's rank (always live)
```

**Quality**: ✅ Good (cached + personalized)

### Campaigns (Merchant)
**Route**: `POST|GET /api/campaigns`  
**Auth**: Merchant API key

```javascript
POST creates campaign with:
- name
- rewardRate (validated: > 0)
- startDate, endDate (validated: end > start)

GET lists all campaigns for merchant
```

**Quality**: ✅ Basic but functional

### Drops (User)
**Route**: `GET|POST /api/drops/{id}/claim`  
**Auth**: User JWT

```javascript
GET /eligible
  → Returns drops user can claim

POST /{id}/claim
  → Verify Merkle proof if drop has merkle_root
  → Record claim
  → Emit event
  → Award points
```

**Quality**: ⚠️ Partially implemented

### Admin Routes
**Route**: `GET /api/admin/stats`, `/users`, `POST|PUT|DELETE /rewards`  
**Auth**: User JWT + admin role

```javascript
GET /stats
  → Users, points issued, redemptions, active rewards

GET /users?search=...&page=1&limit=20
  → Paginated user list

POST /rewards
  → Create reward (name, cost, stock, isActive)
```

**Quality**: ✅ Basic CRUD operations

### Transactions (Blockchain)
**Route**: `POST /api/transactions/record`

```javascript
// Verify transaction on Stellar, then record:
1. Fetch txHash from Horizon
2. Verify it exists
3. Record in DB with type, wallets, amount
```

**Quality**: ✅ Good validation

### ROUTE GAPS

| Endpoint | Status | Impact |
|----------|--------|--------|
| `/api/earn` | ❌ Missing | Can't programmatically earn points |
| `/api/tiers` | ❌ Missing | Can't view/manage tiers |
| `/api/rewards/calculate` | ❌ Missing | Can't preview point earnings |
| `/api/points/expiry` | ❌ Missing | No way to manage expiration |
| `/api/analytics` | ⚠️ Minimal | Limited reporting |

---

## 4. SMART CONTRACTS (Rust/Soroban)

### Nova Rewards Contract ✅ (Partial)
**File**: `contracts/nova-rewards/src/lib.rs`

#### Fixed-Point Arithmetic (Issue #205)
```rust
pub const SCALE_FACTOR: i128 = 1_000_000;  // 6 decimal places

pub fn calculate_payout(balance: i128, rate: i128) -> i128 {
    balance
        .checked_mul(rate)
        .expect("overflow in balance * rate")
        .checked_div(SCALE_FACTOR)
        .expect("overflow in payout / SCALE_FACTOR")
}

// Example:
// Balance: 1000 NOVA (in stroops)
// Rate: 33_333 (3.3333% = 33,333 / 1,000,000)
// Payout: (1000 * 33_333) / 1_000_000 = 33 stroops
```

**Features**:
- ✅ Uses i128 to prevent overflow
- ✅ Multiply first, divide once (precision)
- ✅ Deterministic rounding toward zero
- ✅ Comprehensive comments

#### Cross-Asset Swap (Issue #200)
```rust
pub fn swap_for_xlm(
    env: Env,
    user: Address,
    nova_amount: i128,
    min_xlm_out: i128,
    path: Vec<Address>,  // Multi-hop routing
) -> i128
```

**Features**:
- ✅ Burn NOVA, receive XLM or other assets
- ✅ Slippage protection (min_xlm_out)
- ✅ Multi-hop routing (up to 5 hops)
- ✅ Event emission

**NOT implemented**:
- ❌ Automatic distribution to users
- ❌ Integration with point earning
- ❌ Reward payout triggers

### Reward Pool Contract ✅
**File**: `contracts/reward_pool/src/lib.rs`

```rust
pub fn deposit(from: Address, amount: i128)
  → Add to pool (admin can withdraw)

pub fn withdraw(to: Address, amount: i128)
  → Admin only, with pool balance check

pub fn balance() -> i128
  → Query current pool balance
```

**Limitations**:
- ⚠️ Manual deposit/withdraw only
- ❌ No automatic reward distribution
- ❌ No integration with referral system

### Referral Contract ✅ (Partial)
**File**: `contracts/referral/src/lib.rs`

```rust
pub fn register_referral(referrer: Address, referred: Address)
  → Record referrer for given address (one-time)

pub fn credit_referrer(referred: Address, reward_amount: i128)
  → Admin only, pay referrer from pool

pub fn get_total_referrals(referrer: Address) -> i128
  → Count of referred users
```

**Gaps**:
- ❌ Not integrated with database referral tracking
- ❌ No automatic triggering on new user signup
- ⚠️ Manual payout process

### Integration Gaps

| Component | Status | Issue |
|-----------|--------|-------|
| Automatic point earning | ❌ | No contract trigger for purchase earning |
| Tier-based multipliers | ❌ | Contract doesn't know user tiers |
| Point expiration | ❌ | No expiration in contract layer |
| Reward calculation | ⚠️ | Math exists, not used in earning flow |
| Cross-contract calls | ⚠️ | Possible but not implemented |

---

## 5. POINT EARNING LOGIC - CRITICAL GAP

### Current Implementation
Points can be earned via:
1. **Merchant distribution** (manual): `/api/rewards/distribute` → distributes NOVA tokens
2. **Referral bonus** (manual): `referralService.processReferralBonus()` → called manually
3. **Daily login bonus** (manual): Tracked but no auto-granting visible
4. **Drop claims** (partial): `processClaim()` → awards points

### What's MISSING

#### No Automatic Calculation of Earnings
```javascript
// This function doesn't exist:
async function earnPointsFromTransaction({
  userId,
  merchantId,
  transactionAmount,
  campaignId
}) {
  // Get campaign reward rate
  const campaign = await getCampaignById(campaignId);
  
  // Calculate: transactionAmount * reward_rate = pointsEarned
  const pointsEarned = (transactionAmount * campaign.reward_rate);
  
  // Get user tier (would apply multiplier)
  const userTier = await getUserTier(userId);
  const multiplier = getTierMultiplier(userTier);
  const finalPoints = pointsEarned * multiplier;
  
  // Record earning
  return recordPointTransaction({
    userId,
    type: 'earned',
    amount: finalPoints,
    campaignId
  });
}
```

#### No Entry Point for Point Earning
No API endpoint like:
- `POST /api/points/earn` - For POS systems or e-commerce
- `POST /api/transactions/process` - For purchase recording
- Webhook integration for external purchases

### Example: How It Should Work

**Scenario**: Customer makes $50 purchase at merchant with 5% reward rate

```javascript
// Current flow (manual):
1. Merchant receives $50 cash/card payment (offline)
2. Merchant manually calls: POST /api/rewards/distribute {amount: 2.5, walletAddress}
3. NOVA tokens sent to customer (no points recorded)
4. Customer confused - they have NOVA but no points in the system

// Should be:
1. Merchant POS sends: POST /api/points/earn {userId, amount: 50, campaignId: 5}
2. Backend calculates: 50 * 0.05 = 2.5 points
3. Records point transaction: type='earned', amount=2.5
4. User balance updated: 100 → 102.5
5. Returns: {success: true, pointsEarned: 2.5, newBalance: 102.5}
6. Optionally distributes NOVA via blockchain
```

---

## 6. TIER SYSTEM - NOT IMPLEMENTED

### What's Needed

**Database** (missing):
```sql
CREATE TABLE tiers (
  id              SERIAL PRIMARY KEY,
  name            VARCHAR(50),              -- Bronze, Silver, Gold, Platinum
  min_points      INTEGER NOT NULL,         -- Threshold to reach
  min_spending    NUMERIC(18,2),            -- Alternative: spending-based
  earning_multiplier NUMERIC(3,2) DEFAULT 1.0,  -- Points earning multiplier
  redemption_multiplier NUMERIC(3,2) DEFAULT 1.0,
  benefits        TEXT,                     -- JSON or string
  created_at      TIMESTAMPTZ
);

-- Track user's current tier
ALTER TABLE users ADD COLUMN tier_id INTEGER REFERENCES tiers(id);
ALTER TABLE users ADD COLUMN tier_effective_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN tier_expires_at TIMESTAMPTZ;

-- Audit trail of tier changes
CREATE TABLE tier_history (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  from_tier   INTEGER REFERENCES tiers(id),
  to_tier     INTEGER REFERENCES tiers(id),
  reason      VARCHAR(50),  -- 'threshold_reached', 'threshold_lost', 'downgrade_expired'
  created_at  TIMESTAMPTZ
);
```

**Service Layer** (missing):
```javascript
// Tier calculation
calculateUserTier(userId)
  → Sum earned points from point_transactions
  → Sum spending from redemptions
  → Compare against tier thresholds
  → Update user tier if changed

// Check on every earning/redemption
recalculateTierIfNeeded(userId)

// Get tier info
getUserTierInfo(userId)
  → Current tier
  → Points/spending toward next tier
  → Active multipliers
  → Tier expiration date

// Apply multiplier
getTierMultiplier(tierId, action)
  → action: 'earning' or 'redemption'
  → return: 1.0, 1.25, 1.5, 2.0 etc
```

**API Routes** (missing):
```javascript
GET /api/tiers
  → List all tiers with requirements

GET /api/users/me/tier
  → Current user's tier
  → Progress to next tier
  → Active benefits

GET /api/tiers/{id}/requirements
  → Show what's needed for this tier
```

**Example Tier Structure**:
```
Bronze:     0 - 1,000 points    → 1.0x multiplier
Silver:   1,001 - 5,000 points  → 1.25x multiplier
Gold:     5,001 - 20,000 points → 1.5x multiplier
Platinum: 20,001+ points        → 2.0x multiplier

+ Tier downgrades after 90 days of inactivity
+ Email notifications on tier up/down
```

---

## 7. POINT EXPIRATION - NOT IMPLEMENTED

### Current State
- `type IN ('earned', 'redeemed', 'expired', 'bonus')` - type exists
- No DB mechanism to trigger expiration
- No configuration for expiration period

### What's Missing

**Configuration**:
```javascript
// In configService.js:
POINT_EXPIRATION_DAYS = 365   // Points expire after 1 year
EXPIRATION_CHECK_INTERVAL = 86400000  // Run daily
```

**Service** (missing):
```javascript
async function expireOldPoints() {
  // Find all earned/bonus points older than POINT_EXPIRATION_DAYS
  const expirationDate = NOW - POINT_EXPIRATION_DAYS;
  
  const oldPointsPerUser = {
    userId: SUM(amount where type IN ('earned','bonus') AND created_at < expirationDate)
  };
  
  for (const [userId, amountToExpire] of Object.entries(oldPointsPerUser)) {
    // Record expiration transaction
    await recordPointTransaction({
      userId,
      type: 'expired',
      amount: amountToExpire,
      description: `Points expired (older than ${POINT_EXPIRATION_DAYS} days)`
    });
    
    // Emit event for notification
    appEvents.emit('points.expired', {userId, amountExpired: amountToExpire});
  }
}

// Scheduler (missing):
schedule.scheduleJob('0 2 * * *', expireOldPoints);  // Daily at 2am
```

**Notifications** (missing):
- Email warning 30 days before expiration
- Email confirmation when expired
- Dashboard warning on low-value points about to expire

---

## 8. BLOCKCHAIN ↔ DATABASE SYNC

### Current Architecture

**Database Side** (novaRewards/backend):
- `point_transactions` table tracks points
- `user_balance` table tracks balances
- `redemptions` table tracks redemptions

**Blockchain Side** (Stellar/Soroban):
- Nova Token contract on Stellar
- Reward Pool contract for management
- Referral contract for referral tracking

### Unclear Integration Points

| Flow | DB | Blockchain | Gap |
|------|----|-----------|----|
| Merchant distributes | `rewards.distribute()` endpoint | `sendRewards()` signs TX | ⚠️ No link between NOVA token and DB points |
| User earns | Record point_transaction | ❌ No on-chain record | **CRITICAL** |
| User redeems | Decrements user_balance | ❌ No on-chain redemption | **CRITICAL** |
| Referral bonus | `recordPointTransaction()` | `credit_referrer()` in contract | ⚠️ Not synced |

### Recommended Sync Strategy

**Option 1: DB as Source of Truth** (Simpler)
- All logic in backend
- Points stored in DB only
- Blockchain only for settlement/swaps
- Requires: Trust in backend

**Option 2: Blockchain as Source** (Complex but trustless)
- Contract tracks balances
- Backend queries contract state
- All earning/redemption on-chain
- Requires: Complete contract redesign

**Option 3: Hybrid** (Recommended)
- Points earning in DB (fast, scalable)
- Settlement to blockchain periodically
- Swaps/redemptions can query both
- Requires: Careful reconciliation logic

---

## 9. SUMMARY OF GAPS

### Critical Gaps (Blocks Core Functionality)
| Gap | Impact | Effort | Priority |
|-----|--------|--------|----------|
| No point earning service | Points can't be earned automatically | Medium | P0 |
| No tier system | Can't differentiate users | High | P0 |
| No point expiration | Potential liability | Low | P0 |
| DB-Blockchain sync unclear | Data consistency risk | High | P0 |

### Important Gaps (Degrades UX)
| Gap | Impact | Effort | Priority |
|-----|--------|--------|----------|
| No earning calculation API | Can't preview earnings | Low | P1 |
| No analytics | Hard to optimize campaigns | Medium | P1 |
| No reward recommendations | Can't personalize experience | Medium | P1 |

### Nice-to-Have Gaps
| Gap | Impact | Effort | Priority |
|-----|--------|--------|----------|
| No gamification features | Less engaging | Medium | P2 |
| No bulk reward operations | Admin tedious work | Low | P2 |
| Limited mobile support | Accessibility | Medium | P2 |

---

## 10. RECOMMENDATIONS

### Phase 1: Core Functionality (Weeks 1-2)
1. **Implement Reward Earning Service**
   - `calculateEarnings()` function
   - POST `/api/points/earn` endpoint
   - Point transaction recording
   - Balance update with trigger
   - **Files to create**: `backend/services/earningService.js`, route in `rewards.js`

2. **Implement Point Expiration**
   - Configure expiration period
   - Implement expiration check cron job
   - Add email notifications
   - **Files to create**: Scheduler setup, emailService extension

### Phase 2: Tier System (Weeks 3-4)
1. **Database Schema** - Create tiers, tier_history tables
2. **Service Layer** - Implement tier calculation logic
3. **API Routes** - GET tier info, tier progress
4. **Leaderboard Integration** - Apply tier multipliers
5. **Notifications** - Tier up/down emails

### Phase 3: Advanced Features (Weeks 5+)
1. **Analytics Dashboard** - Campaign ROI, user insights
2. **Reward Recommendations** - ML-based suggestions
3. **Blockchain Sync** - Clear settlement protocol
4. **Admin Tools** - Bulk operations, tier management

---

## 11. IMPLEMENTATION PRIORITY

```
IMMEDIATE (This Sprint):
  □ Implement point earning service & API
  □ Create point expiration scheduler
  □ Add tier schema to database

NEAR-TERM (Next Sprint):
  □ Build tier calculation logic
  □ Add tier API endpoints
  □ Implement tier multipliers in earning

SHORT-TERM (Month 2):
  □ Add analytics service
  □ Implement reward recommendations
  □ Create admin dashboard

LATER:
  □ Gamification (badges, achievements)
  □ Advanced blockchain integration
  □ Mobile app deep integration
```

---

## 12. FILES REFERENCE

### Key Service Files
- [referralService.js](./novaRewards/backend/services/referralService.js) - Referral processing
- [redemptionEventListener.js](./novaRewards/backend/services/redemptionEventListener.js) - Event handling
- [configService.js](./novaRewards/backend/services/configService.js) - Configuration
- [dropService.js](./novaRewards/backend/services/dropService.js) - Drop management

### Key Database Files
- [pointTransactionRepository.js](./novaRewards/backend/db/pointTransactionRepository.js) - Point tracking
- [redemptionRepository.js](./novaRewards/backend/db/redemptionRepository.js) - Redemption logic
- [leaderboardRepository.js](./novaRewards/backend/db/leaderboardRepository.js) - Leaderboard queries

### Key Routes
- [rewards.js](./novaRewards/backend/routes/rewards.js) - Distribution
- [redemptions.js](./novaRewards/backend/routes/redemptions.js) - Redemption
- [leaderboard.js](./novaRewards/backend/routes/leaderboard.js) - Rankings

### Smart Contracts
- [contracts/nova-rewards/src/lib.rs](./contracts/nova-rewards/src/lib.rs) - Main contract
- [contracts/reward_pool/src/lib.rs](./contracts/reward_pool/src/lib.rs) - Pool management
- [contracts/referral/src/lib.rs](./contracts/referral/src/lib.rs) - Referral tracking

### Database Migrations
- [006_redemption_tables.sql](./novaRewards/database/006_redemption_tables.sql) - Core schemas
- [012_user_balance_and_trigger.sql](./novaRewards/database/012_user_balance_and_trigger.sql) - Balance sync
- [014_create_redemptions.sql](./novaRewards/database/014_create_redemptions.sql) - Redemption audit

---

## Conclusion

The Nova Rewards system has **solid fundamentals** with well-designed database schemas and atomic redemption logic. The main challenge is completing the **earning side** of the equation and implementing the **tier system** for differentiation. The recommended approach is to implement point earning in Phase 1, then move to tier systems in Phase 2, followed by advanced analytics and features.

**Next Step**: Begin implementation of the earning service and point expiration logic (Phase 1).
