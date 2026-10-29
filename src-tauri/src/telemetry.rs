//! Anonymous, opt-out usage telemetry (Aptabase). Only counts, durations and
//! enums - never issue keys, descriptions, credentials, paths or notes.

pub fn track_worklogs_created(_count: usize, _hours: f64) {}
