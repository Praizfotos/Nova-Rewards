# Nova Rewards System - Visual Architecture & Flows

## 1. Current System Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          NOVA REWARDS SYSTEM                            │
└─────────────────────────────────────────────────────────────────────────┘

                              Frontend/Mobile
                                    │
                    ┌───────────────┼───────────────┐
                    │               │               │
              ┌─────▼──────┐  ┌────▼──────┐  ┌────▼──────┐
              │  Merchants │  │   Users   │  │   Admin   │
              │    (POS)   │  │  (Mobile) │  │ (Dashboard)
              └─────┬──────┘  └────┬──────┘  └────┬──────┘
                    │               │               │
        ┌───────────┴───────────┬───┴───┬──────────┴───┐
        │                       │       │              │
    ┌───▼──────────────────────▼──┐    │         ┌────▼────────┐
    │   Backend API (Express.js)   │    │         │  Admin API  │
    │  ┌──────────────────────────┐│    │         └────┬────────┘
    │  │   Route Handlers         ││    │              │
    │  ├──────────────────────────┤│    │         ┌────▼──────┐
    │  │ POST /api/rewards/distribute     │         │Stats &    │
    │  │ POST /api/redemptions            │         │Users      │
    │  │ GET  /api/leaderboard            │         └───────────┘
    │  │ POST /api/campaigns              │
    │  │ GET  /api/drops/eligible         │
    │  │ POST /api/drops/{id}/claim       │
    │  └──────────────────────────┘│    │
    │  ┌──────────────────────────┐│    │
    │  │   Service Layer          ││    │
    │  ├──────────────────────────┤│    │
    │  │ referralService.js       ││    │
    │  │ redemptionEventListener  ││    │
    │  │ dropService.js           ││    │
    │  │ emailService.js          ││    │
    │  │ ❌ earningService (MISSING) │    │
    │  │ ❌ tierService (MISSING)    │    │
    │  │ ❌ analyticsService (MISSING)
    │  └──────────────────────────┘│    │
    └───┬──────────────────────────┬────┘
        │                          │
    ┌───▼───────────────┐  ┌──────▼───────────┐
    │  PostgreSQL DB    │  │   Redis Cache    │
    │  ┌────────────────┤  │  (Leaderboard,   │
    │  │ users          │  │   Sessions)      │
    │  │ campaigns      │  └──────────────────┘
    │  │ merchants      │
    │  │ rewards        │
    │  │ point_transactions  ◄─── Audit log
    │  │ redemptions    │
    │  │ user_balance   │
    │  │ drops          │
    │  │ tier_history   │
    │  └────────────────┘
        │
        └──────────────────┐
                           │
                    ┌──────▼──────────────┐
                    │  Blockchain Layer   │
                    │  (Stellar/Soroban)  │
                    ├────────────────────┤
                    │ nova-rewards:       │
                    │ • calculate_payout()
                    │ • swap_for_xlm()    │
                    │                    │
                    │ reward_pool:        │
                    │ • deposit()         │
                    │ • withdraw()        │
                    │                    │
                    │ referral:           │
                    │ • register_referral
                    │ • credit_referrer()
                    └────────────────────┘
```

---

## 2. Current vs. Desired: Point Earning Flow

### ❌ CURRENT FLOW (Broken)

```
Customer makes purchase at merchant
        │
        ▼
❌ MANUAL PROCESS (No automatic trigger)
        │
        ├─ Option A (Wrong): Merchant manually calls
        │  POST /api/rewards/distribute {amount: NOVA_AMOUNT}
        │  ├─ Sends NOVA token to customer wallet
        │  └─ NO point entry in database ❌
        │
        ├─ Option B (Missing): No way for POS to report purchase
        │  to the backend
        │
        └─ Option C (Missing): No earning endpoint exists

Result: Customer has tokens but system doesn't track points ❌
```

### ✅ DESIRED FLOW (To Implement)

```
Customer makes purchase at merchant
        │
        ▼
Merchant POS sends purchase data
        │
        ▼
POST /api/points/earn
  Body: {
    userId: 123,
    transactionAmount: 50.00,
    campaignId: 5
  }
        │
        ▼
Backend Processing (earningService.js)
  1. Get campaign: reward_rate = 0.05 (5%)
  2. Calculate: 50 * 0.05 = 2.5 points
  3. ⭐ NEW: Apply user tier multiplier (if tier = Gold, 1.5x)
  4. Final: 2.5 * 1.5 = 3.75 points
        │
        ▼
Database Recording
  INSERT INTO point_transactions (
    user_id=123,
    type='earned',
    amount=3.75,
    campaign_id=5,
    created_at=NOW()
  )
        │
        ▼
Trigger fires: sync_user_balance()
  UPDATE user_balance
  SET balance = balance + 3.75
        │
        ▼
Event emission: 'points.earned'
  → Sends notification email
  → Updates dashboard cache
  → Records analytics
        │
        ▼
Response to merchant:
  {
    success: true,
    pointsEarned: 3.75,
    newBalance: 28.5,
    transactionId: "tx_abc123"
  }

✅ Result: Points automatically tracked and balanced
```

---

## 3. Tier System Integration (Missing)

### How Tiers Should Work

```
┌────────────────────────────────────────────────┐
│          TIER SYSTEM (MISSING)                 │
└────────────────────────────────────────────────┘

Database:
  ┌─ Bronze:  0 - 1,000 points    (1.0x multiplier)
  ├─ Silver:  1,001 - 5,000       (1.25x multiplier)
  ├─ Gold:    5,001 - 20,000      (1.5x multiplier)
  └─ Platinum: 20,001+             (2.0x multiplier)

Flow:

User earns 100 points
    │
    ▼
tierService.calculateUserTier(userId)
    │ Query: SUM(point_transactions.amount WHERE type='earned')
    │
    ├─ If total = 15,000 → GOLD TIER
    │   └─ multiplier = 1.5x
    │
    ▼
Final points = 100 * 1.5 = 150 points

Event: Tier evaluation happens on each earning
    │
    ├─ Tier increase? → Send email, update balance, record history
    ├─ Tier stable? → Continue normal processing
    └─ Tier decrease (inactivity)? → Send warning email

Tier History Audit Trail:
    USER ID  | FROM_TIER  | TO_TIER  | WHEN
    ---------|------------|----------|----------
    123      | NULL       | BRONZE   | 2026-01-01
    123      | BRONZE     | SILVER   | 2026-02-15
    123      | SILVER     | GOLD     | 2026-04-01
```

---

## 4. Point Expiration Flow (Missing)

```
Point created
    │
    ▼
INSERT INTO point_transactions (
  ...,
  expires_at = NOW() + INTERVAL '365 days'  ← Set 1-year expiry
)
    │
    ├─ Day 300: Email warning "Points expiring in 65 days"
    ├─ Day 330: Email reminder "Points expiring in 35 days"
    │
    ▼
    Day 365: Daily scheduler runs expirationService.expireOldPoints()
    │
    ├─ Find all earned points > 365 days old
    │
    ▼
For each user:
  INSERT INTO point_transactions (
    type='expired',
    amount=expiredAmount,
    description='Points expired (1 year old)'
  )
    │
    ▼
  UPDATE user_balance
    SET balance = balance - expiredAmount
    │
    ▼
  Emit 'points.expired' event
    └─ Send confirmation email

Result: Old points automatically cleaned up ✓
```

---

## 5. Data Flow: Redemption (Currently Working ✅)

```
User requests: Redeem 10 points for reward
    │
    ▼
POST /api/redemptions
  Headers: { "X-Idempotency-Key": "uuid-1234" }
  Body: { userId: 123, rewardId: 5 }
    │
    ▼
Backend (redemptionRepository.js)
    │
    ├─ Step 1: Check idempotency key (prevent duplicate redemptions)
    │   └─ Already redeemed? Return 200 with existing result ✓
    │
    ├─ Step 2: LOCK reward row FOR UPDATE
    │   └─ Verify active, in-stock, not deleted
    │
    ├─ Step 3: LOCK user_balance row FOR UPDATE
    │   └─ Verify user has 10+ points
    │
    ├─ Step 4: Atomic transaction (all or nothing)
    │   ├─ UPDATE rewards SET stock = stock - 1
    │   ├─ INSERT INTO point_transactions (type='redeemed', amount=10)
    │   └─ INSERT INTO redemptions (audit trail)
    │
    ▼
Trigger fires: sync_user_balance()
    └─ user_balance updated automatically
    │
    ▼
Event emission: 'redemption.created'
    ├─ redemptionEventListener catches it
    └─ Sends confirmation email
    │
    ▼
Response:
  {
    success: true,
    data: {
      redemption: { id, user_id, reward_id, points_spent, ... },
      pointTx: { ... }
    }
  }

✓ Atomic, idempotent, auditable
```

---

## 6. Blockchain Integration (Unclear)

```
┌─────────────────────────────────────────────────────┐
│  BLOCKCHAIN ↔ DATABASE SYNC (NEEDS CLARITY)        │
└─────────────────────────────────────────────────────┘

Current Implementation:
├─ Database: point_transactions table (points)
├─ Blockchain: Nova token on Stellar (NOVA tokens)
└─ ⚠️ UNCLEAR HOW THEY SYNC

Merchant Distribute Flow:
  1. Merchant calls: POST /api/rewards/distribute
  2. Backend calls: sendRewards() 
  3. Stellar TX signs and sends NOVA tokens to wallet
  4. ❌ BUT: No point entry in point_transactions table!
  5. Result: Mismatch - customer has NOVA but system doesn't know

Recommendation: Clarify Strategy

Option A (Recommended - DB as source):
  ├─ All point logic in database
  ├─ Blockchain only for settlement/swaps
  └─ On redemption: optionally send tokens

Option B (Blockchain as source - complex):
  ├─ Contract tracks all balances
  ├─ Backend queries contract state
  └─ Requires complete rewrite

Option C (Hybrid - most realistic):
  ├─ Points earning in DB (speed, scalability)
  ├─ Blockchain for final settlement
  ├─ Reconciliation job periodic sync
  └─ Swaps query both for confirmation
```

---

## 7. Existing Features Map

```
┌──────────────────────────────────────────────────────────┐
│              FEATURE IMPLEMENTATION STATUS                │
└──────────────────────────────────────────────────────────┘

FULLY IMPLEMENTED ✅ (Production Ready)
├─ Redemption system (atomic, idempotent)
├─ Referral tracking & bonus
├─ Campaign management
├─ Merchant distribution
├─ Email notifications
├─ Leaderboard (cached)
├─ Admin dashboard
└─ Database schema (core)

PARTIALLY IMPLEMENTED ⚠️ (Needs Completion)
├─ Drop system (Merkle tree validation ~90%)
├─ Blockchain integration (contracts exist, not integrated)
└─ Authentication (JWT working, edge cases)

NOT IMPLEMENTED ❌ (CRITICAL)
├─ Point earning service
├─ Point expiration scheduler
├─ Tier system
└─ Analytics/reporting

FUTURE ENHANCEMENTS 🔮 (Nice-to-have)
├─ Gamification (badges, achievements)
├─ Personalized recommendations
├─ Mobile app deep integration
└─ Advanced blockchain features
```

---

## 8. Integration Points

### What Each Component Depends On

```
Leaderboard
  ├─ Needs: point_transactions table ✓
  └─ Optional: tier_id for tier-based rankings (future)

Redemption
  ├─ Needs: rewards table ✓
  ├─ Needs: user_balance table ✓
  └─ Needs: point_transactions table ✓

Referral
  ├─ Needs: users.referred_by field ✓
  ├─ Calls: recordPointTransaction() ✓
  └─ Optional: tier multiplier (future)

Point Earning (MISSING)
  ├─ Needs: campaigns table ✓
  ├─ Calls: recordPointTransaction() ✓
  ├─ Uses: tier multiplier (future)
  └─ Needs: POST /earn endpoint (MISSING)

Tier System (MISSING)
  ├─ Needs: tiers table (TO CREATE)
  ├─ Needs: tier_history table (TO CREATE)
  ├─ Calls: calculateUserTier() (TO CREATE)
  └─ Affects: point earning multiplier (TO IMPLEMENT)

Point Expiration (MISSING)
  ├─ Needs: point_transactions.expires_at (TO ADD)
  ├─ Calls: expirationService.expireOldPoints() (TO CREATE)
  ├─ Emits: 'points.expired' event (TO IMPLEMENT)
  └─ Sends: expiration emails (TO IMPLEMENT)

Analytics (MISSING)
  ├─ Reads: point_transactions ✓
  ├─ Reads: redemptions ✓
  ├─ Reads: campaigns ✓
  └─ Needs: analyticsService (TO CREATE)
```

---

## 9. Quick Priority Matrix

```
┌─────────────────────────────────────────────────┐
│         IMPLEMENTATION PRIORITY MATRIX           │
└─────────────────────────────────────────────────┘

IMPACT vs. EFFORT

High Impact / Low Effort (DO FIRST):
  ✓ Point Earning Service ⭐ CRITICAL
  ✓ Point Expiration Scheduler
  ✓ Clarify Blockchain Sync

High Impact / Medium Effort (DO NEXT):
  ✓ Tier System
  ✓ Tier Multiplier Integration
  ✓ Admin Analytics Dashboard

Medium Impact / Low Effort (DO ANYTIME):
  ✓ Email templates polish
  ✓ Redis cache optimization
  ✓ Logging improvements

Low Impact / Low Effort (NICE-TO-HAVE):
  - Gamification badges
  - Profile customization
  - Advanced filters

Low Impact / High Effort (SKIP):
  ✗ Complete blockchain rewrite
  ✗ Machine learning recommendations
```

---

## 10. Technology Stack Summary

```
Frontend
├─ Next.js (frontend/package.json)
├─ React context for state
└─ Playwright for e2e tests

Backend
├─ Node.js + Express.js
├─ PostgreSQL (core database)
├─ Redis (caching)
├─ JWT (authentication)
└─ Stellar SDK (blockchain integration)

Smart Contracts
├─ Rust + Soroban SDK
├─ nova-rewards contract
├─ reward_pool contract
└─ referral contract

DevOps
├─ Docker (Dockerfile in backend/)
├─ Jest (testing)
├─ npm/Node package manager
└─ Git for version control
```

---

## 11. Success Metrics

Once all features are implemented, measure:

```
Point Earning Success
├─ Points earned per user per day (target: >50)
├─ Earning rate matches campaign reward rate (accuracy: 100%)
└─ No balance discrepancies (accuracy: 99.9%)

Tier System Success
├─ Users distributed across tiers (expect: 20% Bronze, 30% Silver, 35% Gold, 15% Platinum)
├─ Tier migration rate (target: 5-10% per month)
└─ Multiplier effect on engagement (target: 20% higher redemption for higher tiers)

Point Expiration Success
├─ Old points expired reliably (accuracy: 100%)
├─ Customers notified before expiration (delivery: >95%)
└─ No balance errors (accuracy: 100%)

Overall Platform
├─ User engagement (redemption rate: target 30%)
├─ Merchant satisfaction (NPS: target >70)
├─ System reliability (uptime: target 99.5%)
└─ Performance (API latency: p99 <500ms)
```

---

## Next Steps

1. **Start Here**: Implement Point Earning Service (Week 1)
2. **Then**: Add Point Expiration (Week 2)
3. **After**: Build Tier System (Weeks 3-4)
4. **Finally**: Add Analytics (Week 5+)

See `IMPLEMENTATION_GUIDE.md` for detailed code examples and implementation steps.

