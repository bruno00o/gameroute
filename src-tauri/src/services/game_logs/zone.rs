use chrono::{DateTime, FixedOffset, Local, NaiveDateTime, TimeZone, Utc};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LogZone(Option<FixedOffset>);

impl LogZone {
    pub const LOCAL: Self = Self(None);

    pub fn to_utc(self, local: NaiveDateTime) -> Option<DateTime<Utc>> {
        match self.0 {
            None => Local
                .from_local_datetime(&local)
                .earliest()
                .map(|at| at.with_timezone(&Utc)),
            Some(offset) => offset
                .from_local_datetime(&local)
                .single()
                .map(|at| at.with_timezone(&Utc)),
        }
    }

    #[cfg(test)]
    pub fn offset(self) -> Option<FixedOffset> {
        self.0
    }
}

#[cfg(test)]
pub fn offset(hours: i32) -> LogZone {
    LogZone(FixedOffset::east_opt(hours * 3600))
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::NaiveDate;

    #[test]
    fn local_times_become_instants_in_the_given_zone() {
        let stamp = NaiveDate::from_ymd_opt(2026, 10, 8)
            .unwrap()
            .and_hms_opt(19, 35, 6)
            .unwrap();
        let at = |h: u32| Utc.with_ymd_and_hms(2026, 10, 8, h, 35, 6).unwrap();

        assert_eq!(offset(2).to_utc(stamp), Some(at(17)));
        assert_eq!(offset(0).to_utc(stamp), Some(at(19)));
        assert_eq!(
            offset(-5).to_utc(stamp).map(|t| t.timestamp()),
            Some(at(19).timestamp() + 5 * 3600)
        );
        assert!(LogZone::LOCAL.to_utc(stamp).is_some());
    }
}
