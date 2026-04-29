-- Migration 017: Extend point_transactions table with expiration tracking
-- Adds expiration and claim tracking for reward points

ALTER TABLE point_transactions ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
ALTER TABLE point_transactions ADD COLUMN IF NOT EXISTS is_expired BOOLEAN DEFAULT FALSE;
ALTER TABLE point_transactions ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ;
ALTER TABLE point_transactions ADD COLUMN IF NOT EXISTS metadata JSONB;

-- Index for expired points
CREATE INDEX IF NOT EXISTS idx_point_transactions_expires_at ON point_transactions (expires_at);
CREATE INDEX IF NOT EXISTS idx_point_transactions_is_expired ON point_transactions (is_expired);
CREATE INDEX IF NOT EXISTS idx_point_transactions_claimed_at ON point_transactions (claimed_at);

-- Function to automatically mark expired points
CREATE OR REPLACE FUNCTION mark_expired_points()
RETURNS void AS $$
BEGIN
  UPDATE point_transactions
  SET is_expired = TRUE
  WHERE is_expired = FALSE
    AND expires_at IS NOT NULL
    AND expires_at < NOW()
    AND type IN ('earned', 'bonus', 'referral');
END;
$$ LANGUAGE plpgsql;

-- Trigger to recalculate user balance when points expire
CREATE OR REPLACE FUNCTION update_balance_on_expiration()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.is_expired = TRUE AND OLD.is_expired = FALSE THEN
    -- Update user balance to subtract expired points
    UPDATE user_balance
    SET balance = balance - NEW.amount
    WHERE user_id = NEW.user_id AND balance >= NEW.amount;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_point_expiration_balance
BEFORE UPDATE ON point_transactions
FOR EACH ROW
WHEN (OLD.is_expired IS DISTINCT FROM NEW.is_expired)
EXECUTE FUNCTION update_balance_on_expiration();
