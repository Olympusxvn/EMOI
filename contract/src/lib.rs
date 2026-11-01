// EMOI PolicyVault contract.
//
// The contract holds the owner's funds and enforces the spending policy
// on-chain. The agent account holds only a Function Call Key scoped to
// `agent_transfer` on this contract; that key cannot attach NEAR and
// cannot transfer NEAR by itself, which is why the limits live here,
// not in the key and not in any frontend.
//
// Frozen rules (STRATEGY.md section 9.2):
// - Agents and policies are keyed by Agent ID, which is the agent
//   sub-account ID (e.g. `agent.emoi.testnet`). No separate numeric ID.
// - Ledger is per owner; policy is per agent.
// - `set_policy` does NOT reset `spent_today` and does NOT change status.
// - `agent_transfer` check order, stopping at the first failure:
//   1. AgentNotRegistered / AgentPaused / AgentRevoked (status check)
//   2. RecipientNotWhitelisted
//   3. InvalidAmount (amount == 0)
//   4. ExceedsMaxPerTx
//   5. ExceedsDailyLimit (after lazy day reset)
//   6. InsufficientVaultBalance
// - State (spent_today, owner ledger) is updated BEFORE the transfer
//   promise. This is a documented NEAR async limitation, not claimed
//   as atomic rollback.
// - Revoke is terminal: a revoked agent cannot be re-registered.
// - Storage is paid by the contract account in the MVP (single-tenant
//   demo limitation, documented in the README).
use near_sdk::store::LookupMap;
use near_sdk::{AccountId, NearToken, PanicOnDefault, Promise, env, near, require};

/// One day, in milliseconds. `current_day = block_timestamp_ms / DAY_MS`.
const DAY_MS: u64 = 86_400_000;
/// Maximum whitelist entries per policy (frozen).
const MAX_WHITELIST: usize = 20;

#[near(serializers = [json, borsh])]
#[derive(Clone, PartialEq, Eq, Debug)]
pub enum AgentStatus {
    Active,
    Paused,
    Revoked,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug)]
pub struct Agent {
    pub owner: AccountId,
    pub status: AgentStatus,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug)]
pub struct Policy {
    pub max_per_tx: NearToken,
    pub daily_limit: NearToken,
    pub whitelist: Vec<AccountId>,
    pub spent_today: NearToken,
    pub current_day: u64,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    /// Agent ID (agent sub-account ID) -> agent record.
    agents: LookupMap<AccountId, Agent>,
    /// Agent ID -> policy. One policy per agent.
    policies: LookupMap<AccountId, Policy>,
    /// Owner account ID -> vault balance. One ledger per owner.
    ledgers: LookupMap<AccountId, NearToken>,
}

fn current_day() -> u64 {
    // env::block_timestamp() is nanoseconds.
    (env::block_timestamp() / 1_000_000) / DAY_MS
}

fn yocto(token: NearToken) -> u128 {
    token.as_yoctonear()
}

#[near]
impl Contract {
    #[init]
    pub fn new() -> Self {
        Self {
            agents: LookupMap::new(b"a"),
            policies: LookupMap::new(b"p"),
            ledgers: LookupMap::new(b"l"),
        }
    }

    /// Register an agent. The caller becomes the owner of this agent.
    /// Re-registering an existing agent (including a revoked one) fails,
    /// which is what makes revoke terminal.
    pub fn register_agent(&mut self, agent_account_id: AccountId) {
        let owner = env::predecessor_account_id();
        require!(
            !self.agents.contains_key(&agent_account_id),
            "PolicyViolation: AgentAlreadyRegistered"
        );
        self.agents.insert(
            agent_account_id,
            Agent {
                owner,
                status: AgentStatus::Active,
            },
        );
    }

    /// Set or replace the policy for an agent. Only that agent's owner
    /// may call this. Existing spent_today/current_day and status are
    /// preserved; a policy change never resets the day's spending.
    pub fn set_policy(
        &mut self,
        agent_account_id: AccountId,
        max_per_tx: NearToken,
        daily_limit: NearToken,
        whitelist: Vec<AccountId>,
    ) {
        let caller = env::predecessor_account_id();
        let agent = self
            .agents
            .get(&agent_account_id)
            .expect("PolicyViolation: AgentNotRegistered");
        require!(
            agent.owner == caller,
            "PolicyViolation: OnlyOwnerCanSetPolicy"
        );
        require!(
            yocto(max_per_tx) > 0 && yocto(daily_limit) > 0,
            "PolicyViolation: InvalidPolicy"
        );
        require!(
            yocto(max_per_tx) <= yocto(daily_limit),
            "PolicyViolation: InvalidPolicy"
        );
        require!(
            whitelist.len() <= MAX_WHITELIST,
            "PolicyViolation: InvalidPolicy"
        );
        // Deduplicate the whitelist, preserving order. An empty
        // whitelist is allowed and means no transfer can pass.
        let mut deduped: Vec<AccountId> = Vec::new();
        for entry in whitelist {
            if !deduped.contains(&entry) {
                deduped.push(entry);
            }
        }
        let (spent_today, current_day) = match self.policies.get(&agent_account_id) {
            Some(existing) => (existing.spent_today, existing.current_day),
            None => (NearToken::from_yoctonear(0), current_day()),
        };
        self.policies.insert(
            agent_account_id,
            Policy {
                max_per_tx,
                daily_limit,
                whitelist: deduped,
                spent_today,
                current_day,
            },
        );
    }

    /// Deposit NEAR into the caller's own vault ledger.
    #[payable]
    pub fn deposit_funds(&mut self) {
        let caller = env::predecessor_account_id();
        let deposit = env::attached_deposit();
        let balance = self
            .ledgers
            .get(&caller)
            .cloned()
            .unwrap_or(NearToken::from_yoctonear(0));
        self.ledgers.insert(
            caller,
            NearToken::from_yoctonear(yocto(balance) + yocto(deposit)),
        );
    }

    /// Withdraw NEAR from the caller's own vault ledger. State is
    /// updated before the transfer promise (reentrancy protection).
    pub fn withdraw(&mut self, amount: NearToken) -> Promise {
        let caller = env::predecessor_account_id();
        let balance = self
            .ledgers
            .get(&caller)
            .cloned()
            .unwrap_or(NearToken::from_yoctonear(0));
        require!(
            yocto(amount) <= yocto(balance),
            "PolicyViolation: InsufficientVaultBalance"
        );
        self.ledgers.insert(
            caller.clone(),
            NearToken::from_yoctonear(yocto(balance) - yocto(amount)),
        );
        Promise::new(caller).transfer(amount)
    }

    /// Pause an agent. Only its owner may pause, and only an Active
    /// agent can be paused.
    pub fn pause_agent(&mut self, agent_account_id: AccountId) {
        let mut agent = self.require_owner_agent(&agent_account_id);
        require!(
            agent.status == AgentStatus::Active,
            "PolicyViolation: AgentNotActive"
        );
        agent.status = AgentStatus::Paused;
        self.agents.insert(agent_account_id, agent);
    }

    /// Resume a paused agent. Only its owner may resume, and only a
    /// Paused agent can be resumed. A revoked agent cannot be resumed.
    pub fn resume_agent(&mut self, agent_account_id: AccountId) {
        let mut agent = self.require_owner_agent(&agent_account_id);
        require!(
            agent.status == AgentStatus::Paused,
            "PolicyViolation: AgentNotPaused"
        );
        agent.status = AgentStatus::Active;
        self.agents.insert(agent_account_id, agent);
    }

    /// Revoke an agent. Only its owner may revoke. Revoke is terminal:
    /// `register_agent` refuses an existing (including revoked) agent,
    /// and `resume_agent` refuses a revoked agent.
    pub fn revoke_agent(&mut self, agent_account_id: AccountId) {
        let mut agent = self.require_owner_agent(&agent_account_id);
        require!(
            agent.status != AgentStatus::Revoked,
            "PolicyViolation: AgentAlreadyRevoked"
        );
        agent.status = AgentStatus::Revoked;
        self.agents.insert(agent_account_id, agent);
    }

    /// Transfer NEAR from the owner's vault to a recipient, called by
    /// the agent account itself through its Function Call Key.
    /// Checks run in the frozen order and stop at the first failure.
    /// On success, spent_today and the owner ledger are updated BEFORE
    /// the transfer promise (documented async limitation).
    pub fn agent_transfer(&mut self, recipient: AccountId, amount: NearToken) -> Promise {
        let agent_id = env::predecessor_account_id();
        let agent = self
            .agents
            .get(&agent_id)
            .expect("PolicyViolation: AgentNotRegistered");
        // Status check, in order: revoked and paused both reject here,
        // before any whitelist or limit check.
        match agent.status {
            AgentStatus::Active => {}
            AgentStatus::Paused => {
                panic!("PolicyViolation: AgentPaused");
            }
            AgentStatus::Revoked => {
                panic!("PolicyViolation: AgentRevoked");
            }
        }
        let mut policy = self
            .policies
            .get(&agent_id)
            .expect("PolicyViolation: AgentNotRegistered")
            .clone();
        require!(
            policy.whitelist.contains(&recipient),
            "PolicyViolation: RecipientNotWhitelisted"
        );
        require!(yocto(amount) > 0, "PolicyViolation: InvalidAmount");
        require!(
            yocto(amount) <= yocto(policy.max_per_tx),
            "PolicyViolation: ExceedsMaxPerTx"
        );
        // Lazy day reset, mirrored by the local re-validation layer.
        let today = current_day();
        if policy.current_day != today {
            policy.spent_today = NearToken::from_yoctonear(0);
            policy.current_day = today;
        }
        require!(
            yocto(amount) <= yocto(policy.daily_limit) - yocto(policy.spent_today),
            "PolicyViolation: ExceedsDailyLimit"
        );
        let owner = agent.owner.clone();
        let balance = self
            .ledgers
            .get(&owner)
            .cloned()
            .unwrap_or(NearToken::from_yoctonear(0));
        require!(
            yocto(amount) <= yocto(balance),
            "PolicyViolation: InsufficientVaultBalance"
        );
        // Update state BEFORE the transfer promise.
        policy.spent_today =
            NearToken::from_yoctonear(yocto(policy.spent_today) + yocto(amount));
        self.policies.insert(agent_id.clone(), policy);
        self.ledgers.insert(
            owner,
            NearToken::from_yoctonear(yocto(balance) - yocto(amount)),
        );
        // NEP-297 success event. The standard/version/event/data shape
        // is finalized against nep-0297.md in Phase 4; the event name
        // and fields below are the contract's public event contract.
        env::log_str(&format!(
            "EVENT_JSON:{{\"standard\":\"emoi\",\"version\":\"1.0.0\",\"event\":\"transfer_succeeded\",\"data\":{{\"agent\":\"{}\",\"recipient\":\"{}\",\"amount\":\"{}\"}}}}",
            agent_id, recipient, yocto(amount)
        ));
        Promise::new(recipient).transfer(amount)
    }

    /// View: agent record by Agent ID, if registered.
    pub fn get_agent_state(&self, agent_account_id: AccountId) -> Option<Agent> {
        self.agents.get(&agent_account_id).cloned()
    }

    /// View: policy by Agent ID, if set.
    pub fn get_policy(&self, agent_account_id: AccountId) -> Option<Policy> {
        self.policies.get(&agent_account_id).cloned()
    }

    /// View: vault balance by owner, 0 when the owner never deposited.
    pub fn get_balance(&self, owner: AccountId) -> NearToken {
        self.ledgers
            .get(&owner)
            .cloned()
            .unwrap_or(NearToken::from_yoctonear(0))
    }
}

impl Contract {
    /// Load an agent and require the caller to be its owner.
    fn require_owner_agent(&self, agent_account_id: &AccountId) -> Agent {
        let caller = env::predecessor_account_id();
        let agent = self
            .agents
            .get(agent_account_id)
            .expect("PolicyViolation: AgentNotRegistered")
            .clone();
        require!(
            agent.owner == caller,
            "PolicyViolation: OnlyOwnerCanManageAgent"
        );
        agent
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::VMContextBuilder;
    use near_sdk::testing_env;

    fn owner() -> AccountId {
        "emoi.testnet".parse().unwrap()
    }
    fn agent() -> AccountId {
        "agent.emoi.testnet".parse().unwrap()
    }
    fn vendor1() -> AccountId {
        "emoi01.testnet".parse().unwrap()
    }
    fn vendor2() -> AccountId {
        "emoi02.testnet".parse().unwrap()
    }
    fn attacker() -> AccountId {
        "attacker.near".parse().unwrap()
    }
    fn other() -> AccountId {
        "other.testnet".parse().unwrap()
    }

    fn set_context(predecessor: AccountId, attached: NearToken, timestamp_ns: u64) {
        let mut builder = VMContextBuilder::new();
        builder
            .current_account_id("policy.emoi.testnet".parse().unwrap())
            .signer_account_id(predecessor.clone())
            .predecessor_account_id(predecessor)
            .attached_deposit(attached)
            .block_timestamp(timestamp_ns);
        testing_env!(builder.build());
    }

    /// Frozen demo policy: max 1 NEAR, daily 2 NEAR, whitelist both vendors.
    fn setup_with_policy_and_funds() -> Contract {
        set_context(owner(), NearToken::from_yoctonear(0), 0);
        let mut contract = Contract::new();
        contract.register_agent(agent());
        contract.set_policy(
            agent(),
            NearToken::from_near(1),
            NearToken::from_near(2),
            vec![vendor1(), vendor2()],
        );
        set_context(owner(), NearToken::from_near(5), 0);
        contract.deposit_funds();
        contract
    }

    #[test]
    fn register_agent_twice_reverts() {
        set_context(owner(), NearToken::from_yoctonear(0), 0);
        let mut contract = Contract::new();
        contract.register_agent(agent());
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            contract.register_agent(agent());
        }));
        assert!(result.is_err(), "second register_agent must revert");
    }

    #[test]
    fn set_policy_by_non_owner_reverts() {
        set_context(owner(), NearToken::from_yoctonear(0), 0);
        let mut contract = Contract::new();
        contract.register_agent(agent());
        set_context(other(), NearToken::from_yoctonear(0), 0);
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            contract.set_policy(
                agent(),
                NearToken::from_near(1),
                NearToken::from_near(2),
                vec![vendor1()],
            );
        }));
        assert!(result.is_err(), "non-owner set_policy must revert");
    }

    #[test]
    fn set_policy_max_gt_daily_reverts() {
        set_context(owner(), NearToken::from_yoctonear(0), 0);
        let mut contract = Contract::new();
        contract.register_agent(agent());
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            contract.set_policy(
                agent(),
                NearToken::from_near(3),
                NearToken::from_near(2),
                vec![vendor1()],
            );
        }));
        assert!(result.is_err(), "max > daily must revert");
    }

    #[test]
    fn set_policy_does_not_reset_spent_today() {
        let mut contract = setup_with_policy_and_funds();
        set_context(agent(), NearToken::from_yoctonear(0), 0);
        let _ = contract.agent_transfer(vendor1(), NearToken::from_near(1));
        // Owner changes the policy; spent_today must survive the change.
        set_context(owner(), NearToken::from_yoctonear(0), 0);
        contract.set_policy(
            agent(),
            NearToken::from_near(1),
            NearToken::from_near(3),
            vec![vendor1(), vendor2()],
        );
        let policy = contract.get_policy(agent()).expect("policy must exist");
        assert_eq!(policy.spent_today, NearToken::from_near(1));
        let state = contract.get_agent_state(agent()).expect("agent must exist");
        assert_eq!(state.status, AgentStatus::Active);
    }

    #[test]
    fn withdraw_only_own_balance() {
        let mut contract = setup_with_policy_and_funds();
        // Another account with no ledger balance cannot withdraw.
        set_context(other(), NearToken::from_yoctonear(0), 0);
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let _ = contract.withdraw(NearToken::from_near(1));
        }));
        assert!(result.is_err(), "withdraw from empty ledger must revert");
        // The owner can withdraw from its own ledger.
        set_context(owner(), NearToken::from_yoctonear(0), 0);
        let _ = contract.withdraw(NearToken::from_near(1));
        assert_eq!(contract.get_balance(owner()), NearToken::from_near(4));
    }

    #[test]
    fn withdraw_exceeding_balance_reverts() {
        let mut contract = setup_with_policy_and_funds();
        set_context(owner(), NearToken::from_yoctonear(0), 0);
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let _ = contract.withdraw(NearToken::from_near(6));
        }));
        assert!(result.is_err(), "withdraw above balance must revert");
    }

    #[test]
    fn valid_transfer_succeeds() {
        let mut contract = setup_with_policy_and_funds();
        set_context(agent(), NearToken::from_yoctonear(0), 0);
        let _ = contract.agent_transfer(vendor1(), NearToken::from_near(1));
        let policy = contract.get_policy(agent()).expect("policy must exist");
        assert_eq!(policy.spent_today, NearToken::from_near(1));
        assert_eq!(contract.get_balance(owner()), NearToken::from_near(4));
    }

    #[test]
    fn attack_non_whitelisted_recipient_reverts() {
        let mut contract = setup_with_policy_and_funds();
        set_context(agent(), NearToken::from_yoctonear(0), 0);
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let _ = contract.agent_transfer(attacker(), NearToken::from_near(1));
        }));
        assert!(result.is_err(), "non-whitelisted transfer must revert");
        assert_eq!(contract.get_balance(owner()), NearToken::from_near(5));
    }

    #[test]
    fn attack_exceeding_daily_limit_reverts() {
        let mut contract = setup_with_policy_and_funds();
        // Spend the full daily limit with two max-sized transfers.
        set_context(agent(), NearToken::from_yoctonear(0), 0);
        let _ = contract.agent_transfer(vendor1(), NearToken::from_near(1));
        let _ = contract.agent_transfer(vendor1(), NearToken::from_near(1));
        // A third transfer is within max per tx but exceeds the daily limit.
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let _ = contract.agent_transfer(vendor1(), NearToken::from_near(1));
        }));
        assert!(result.is_err(), "daily-limit transfer must revert");
        assert_eq!(contract.get_balance(owner()), NearToken::from_near(3));
    }

    #[test]
    fn attack_after_revoke_reverts() {
        let mut contract = setup_with_policy_and_funds();
        set_context(owner(), NearToken::from_yoctonear(0), 0);
        contract.revoke_agent(agent());
        set_context(agent(), NearToken::from_yoctonear(0), 0);
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let _ = contract.agent_transfer(vendor1(), NearToken::from_near(1));
        }));
        assert!(result.is_err(), "revoked agent transfer must revert");
    }

    #[test]
    fn revoked_agent_cannot_be_reregistered() {
        let mut contract = setup_with_policy_and_funds();
        set_context(owner(), NearToken::from_yoctonear(0), 0);
        contract.revoke_agent(agent());
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            contract.register_agent(agent());
        }));
        assert!(result.is_err(), "revoked agent re-register must revert");
    }

    #[test]
    fn paused_agent_cannot_transfer() {
        let mut contract = setup_with_policy_and_funds();
        set_context(owner(), NearToken::from_yoctonear(0), 0);
        contract.pause_agent(agent());
        set_context(agent(), NearToken::from_yoctonear(0), 0);
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let _ = contract.agent_transfer(vendor1(), NearToken::from_near(1));
        }));
        assert!(result.is_err(), "paused agent transfer must revert");
        // Resume restores the ability to transfer.
        set_context(owner(), NearToken::from_yoctonear(0), 0);
        contract.resume_agent(agent());
        set_context(agent(), NearToken::from_yoctonear(0), 0);
        let _ = contract.agent_transfer(vendor1(), NearToken::from_near(1));
        assert_eq!(contract.get_balance(owner()), NearToken::from_near(4));
    }

    #[test]
    fn daily_limit_resets_next_day() {
        let mut contract = setup_with_policy_and_funds();
        set_context(agent(), NearToken::from_yoctonear(0), 0);
        let _ = contract.agent_transfer(vendor1(), NearToken::from_near(1));
        // Advance one full day (in nanoseconds).
        let next_day_ns: u64 = DAY_MS * 1_000_000;
        set_context(agent(), NearToken::from_yoctonear(0), next_day_ns);
        let _ = contract.agent_transfer(vendor1(), NearToken::from_near(1));
        let policy = contract.get_policy(agent()).expect("policy must exist");
        assert_eq!(policy.spent_today, NearToken::from_near(1));
        assert_eq!(policy.current_day, 1);
    }

    #[test]
    fn invalid_amount_rejected() {
        let mut contract = setup_with_policy_and_funds();
        set_context(agent(), NearToken::from_yoctonear(0), 0);
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let _ = contract.agent_transfer(vendor1(), NearToken::from_yoctonear(0));
        }));
        assert!(result.is_err(), "zero-amount transfer must revert");
    }

    #[test]
    fn insufficient_vault_balance_rejected() {
        set_context(owner(), NearToken::from_yoctonear(0), 0);
        let mut contract = Contract::new();
        contract.register_agent(agent());
        contract.set_policy(
            agent(),
            NearToken::from_near(1),
            NearToken::from_near(2),
            vec![vendor1()],
        );
        // Only 0.3 NEAR in the vault; a 0.5 NEAR transfer is within
        // max and daily but above the vault balance.
        set_context(
            owner(),
            NearToken::from_yoctonear(300_000_000_000_000_000_000_000),
            0,
        );
        contract.deposit_funds();
        set_context(agent(), NearToken::from_yoctonear(0), 0);
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let _ = contract.agent_transfer(
                vendor1(),
                NearToken::from_yoctonear(500_000_000_000_000_000_000_000),
            );
        }));
        assert!(result.is_err(), "vault-insufficient transfer must revert");
    }
}
