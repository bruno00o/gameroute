use chrono::{DateTime, Utc};

pub const CACHE_MIN_TTL_DAYS: i64 = 7;
pub const CACHE_MAX_TTL_DAYS: i64 = 30;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CacheDecision {
    UseCache,
    PreferCacheAllowRefresh,
    RequireRefresh,
    UseStaleCache,
}

pub fn cache_age_days(resolved_at: &str) -> Option<i64> {
    parse_resolved_at(resolved_at)
        .map(|resolved_time| Utc::now().signed_duration_since(resolved_time).num_days())
}

pub fn should_use_cache(resolved_at: &str, is_offline: bool) -> CacheDecision {
    let age_days = match cache_age_days(resolved_at) {
        Some(days) => days,
        None => {
            return if is_offline {
                CacheDecision::UseStaleCache
            } else {
                CacheDecision::RequireRefresh
            }
        }
    };

    match age_days {
        d if d < CACHE_MIN_TTL_DAYS => CacheDecision::UseCache,
        d if d <= CACHE_MAX_TTL_DAYS => {
            if is_offline {
                CacheDecision::UseCache
            } else {
                CacheDecision::PreferCacheAllowRefresh
            }
        }
        _ => {
            if is_offline {
                CacheDecision::UseStaleCache
            } else {
                CacheDecision::RequireRefresh
            }
        }
    }
}

fn parse_resolved_at(resolved_at: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(resolved_at)
        .map(|dt| dt.with_timezone(&Utc))
        .ok()
}

pub fn now_iso8601() -> String {
    Utc::now().to_rfc3339()
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Duration;

    fn timestamp_days_ago(days: i64) -> String {
        (Utc::now() - Duration::days(days)).to_rfc3339()
    }

    fn is_cache_valid(resolved_at: &str, min_ttl_days: i64) -> bool {
        match parse_resolved_at(resolved_at) {
            Some(resolved_time) => {
                let age = Utc::now().signed_duration_since(resolved_time);
                age.num_days() < min_ttl_days
            }
            None => false,
        }
    }

    fn is_cache_stale(resolved_at: &str, max_ttl_days: i64) -> bool {
        match parse_resolved_at(resolved_at) {
            Some(resolved_time) => {
                let age = Utc::now().signed_duration_since(resolved_time);
                age.num_days() > max_ttl_days
            }
            None => true,
        }
    }

    #[test]
    fn test_cache_valid_fresh_entry() {
        let resolved_at = timestamp_days_ago(0);
        assert!(is_cache_valid(&resolved_at, CACHE_MIN_TTL_DAYS));
    }

    #[test]
    fn test_cache_valid_6_days_old() {
        let resolved_at = timestamp_days_ago(6);
        assert!(is_cache_valid(&resolved_at, CACHE_MIN_TTL_DAYS));
    }

    #[test]
    fn test_cache_invalid_7_days_old() {
        let resolved_at = timestamp_days_ago(7);
        assert!(!is_cache_valid(&resolved_at, CACHE_MIN_TTL_DAYS));
    }

    #[test]
    fn test_cache_invalid_8_days_old() {
        let resolved_at = timestamp_days_ago(8);
        assert!(!is_cache_valid(&resolved_at, CACHE_MIN_TTL_DAYS));
    }

    #[test]
    fn test_cache_not_stale_29_days() {
        let resolved_at = timestamp_days_ago(29);
        assert!(!is_cache_stale(&resolved_at, CACHE_MAX_TTL_DAYS));
    }

    #[test]
    fn test_cache_not_stale_30_days() {
        let resolved_at = timestamp_days_ago(30);
        assert!(!is_cache_stale(&resolved_at, CACHE_MAX_TTL_DAYS));
    }

    #[test]
    fn test_cache_stale_31_days() {
        let resolved_at = timestamp_days_ago(31);
        assert!(is_cache_stale(&resolved_at, CACHE_MAX_TTL_DAYS));
    }

    #[test]
    fn test_cache_stale_60_days() {
        let resolved_at = timestamp_days_ago(60);
        assert!(is_cache_stale(&resolved_at, CACHE_MAX_TTL_DAYS));
    }

    #[test]
    fn test_decision_fresh_cache_online() {
        let resolved_at = timestamp_days_ago(3);
        assert_eq!(
            should_use_cache(&resolved_at, false),
            CacheDecision::UseCache
        );
    }

    #[test]
    fn test_decision_fresh_cache_offline() {
        let resolved_at = timestamp_days_ago(3);
        assert_eq!(
            should_use_cache(&resolved_at, true),
            CacheDecision::UseCache
        );
    }

    #[test]
    fn test_decision_acceptable_cache_online() {
        let resolved_at = timestamp_days_ago(15);
        assert_eq!(
            should_use_cache(&resolved_at, false),
            CacheDecision::PreferCacheAllowRefresh
        );
    }

    #[test]
    fn test_decision_acceptable_cache_offline() {
        let resolved_at = timestamp_days_ago(15);
        assert_eq!(
            should_use_cache(&resolved_at, true),
            CacheDecision::UseCache
        );
    }

    #[test]
    fn test_decision_stale_cache_online() {
        let resolved_at = timestamp_days_ago(35);
        assert_eq!(
            should_use_cache(&resolved_at, false),
            CacheDecision::RequireRefresh
        );
    }

    #[test]
    fn test_decision_stale_cache_offline() {
        let resolved_at = timestamp_days_ago(35);
        assert_eq!(
            should_use_cache(&resolved_at, true),
            CacheDecision::UseStaleCache
        );
    }

    #[test]
    fn test_invalid_timestamp_treated_as_invalid() {
        assert!(!is_cache_valid("invalid-date", CACHE_MIN_TTL_DAYS));
    }

    #[test]
    fn test_invalid_timestamp_treated_as_stale() {
        assert!(is_cache_stale("invalid-date", CACHE_MAX_TTL_DAYS));
    }

    #[test]
    fn test_cache_age_days() {
        let resolved_at = timestamp_days_ago(10);
        let age = cache_age_days(&resolved_at).unwrap();
        assert!(age >= 10 && age <= 11);
    }

    #[test]
    fn test_now_iso8601_format() {
        let now = now_iso8601();

        assert!(parse_resolved_at(&now).is_some());
    }
}
