//! Port of `src/shared/reportFilename.ts`: validates and renders the PDF
//! filename template. The renderer keeps its own copy for live validation.

use regex::Regex;

pub const DEFAULT_TEMPLATE: &str = "tempo-{layout}-{YYYY-MM}.pdf";

const ALLOWED_TOKENS: [&str; 4] = ["{MM}", "{YYYY}", "{YYYY-MM}", "{layout}"];

/// Returns the error code the renderer translates, or None when valid.
pub fn validate_template(template: &str) -> Option<&'static str> {
    let trimmed = template.trim();
    if trimmed.is_empty() {
        return Some("empty");
    }
    let token = Regex::new(r"\{[^{}]+\}").unwrap();
    if token.find_iter(trimmed).any(|m| !ALLOWED_TOKENS.contains(&m.as_str())) {
        return Some("unknown-token");
    }
    if token.replace_all(trimmed, "").contains(['{', '}']) {
        return Some("unknown-token");
    }
    let has_period = trimmed.contains("{YYYY-MM}") || (trimmed.contains("{YYYY}") && trimmed.contains("{MM}"));
    if !has_period {
        return Some("missing-period");
    }
    let sample = trimmed
        .replace("{YYYY-MM}", "2026-06")
        .replace("{YYYY}", "2026")
        .replace("{MM}", "06")
        .replace("{layout}", "summary");
    if sample.chars().any(|c| "<>:\"/\\|?*".contains(c) || (c as u32) < 0x20) {
        return Some("invalid-character");
    }
    let with_extension = if sample.to_lowercase().ends_with(".pdf") { sample } else { format!("{sample}.pdf") };
    if with_extension.chars().count() > 180 {
        return Some("too-long");
    }
    let reserved = Regex::new(r"(?i)^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)").unwrap();
    if reserved.is_match(&with_extension) {
        return Some("reserved-name");
    }
    None
}

pub fn format_filename(template: &str, month: &str, layout: &str) -> Result<String, String> {
    if let Some(error) = validate_template(template) {
        return Err(error.into());
    }
    let pattern = Regex::new(r"^(\d{4})-(\d{2})$").unwrap();
    let caps = pattern.captures(month).ok_or("invalid-month")?;
    let (year, number) = (&caps[1], &caps[2]);
    let rendered = template
        .trim()
        .replace("{YYYY-MM}", &format!("{year}-{number}"))
        .replace("{YYYY}", year)
        .replace("{MM}", number)
        .replace("{layout}", layout);
    Ok(if rendered.to_lowercase().ends_with(".pdf") { rendered } else { format!("{rendered}.pdf") })
}
