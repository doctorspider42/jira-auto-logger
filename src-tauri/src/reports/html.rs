//! The report as an HTML page - the same markup and styles as the Electron
//! version, plus the footer as CSS page-margin boxes (the webview prints them).

use super::{MonthRange, ReportEntry};
use crate::domain::{AppConfig, AttrValue, CustomFieldConfig, ReportRequest};
use std::collections::{BTreeMap, HashSet};

struct GroupNode<'a> {
    label: String,
    entries: Vec<&'a ReportEntry>,
    seconds: i64,
    children: Vec<GroupNode<'a>>,
}

fn escape_html(value: &str) -> String {
    value
        .replace(['—', '–', '‑'], "-")
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#039;")
}

/// A CSS string literal for `content:` in the page-margin boxes.
fn css_string(value: &str) -> String {
    format!("\"{}\"", value.replace('\\', "\\\\").replace('"', "\\\""))
}

fn seconds_of(entries: &[&ReportEntry]) -> i64 {
    entries.iter().map(|e| e.worklog.time_spent_seconds).sum()
}

fn format_time(seconds: i64, format: &str) -> String {
    if format == "hours-minutes" {
        let minutes = (seconds as f64 / 60.0).round() as i64;
        return format!("{}:{:02}", minutes / 60, minutes % 60);
    }
    let hours = seconds as f64 / 3600.0;
    if hours.fract() == 0.0 {
        format!("{hours:.0}")
    } else {
        let text = format!("{hours:.2}");
        text.strip_suffix('0').map(String::from).unwrap_or(text)
    }
}

fn tempo_date(iso: &str) -> String {
    const MONTHS: [&str; 12] = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    let parts: Vec<usize> = iso.split('-').filter_map(|p| p.parse().ok()).collect();
    match parts.as_slice() {
        [year, month, day] => format!("{day:02}/{}/{:02}", MONTHS[(month - 1).min(11)], year % 100),
        _ => iso.to_string(),
    }
}

fn custom_field<'c>(config: &'c AppConfig, key: &str) -> Option<&'c CustomFieldConfig> {
    let id = key.strip_prefix("custom:")?;
    config.custom_fields.iter().find(|f| f.id == id)
}

fn attribute_value<'e>(entry: &'e ReportEntry, field: &CustomFieldConfig) -> Option<&'e AttrValue> {
    if entry.connection.id != field.connection_id {
        return None;
    }
    entry.worklog.attributes.iter().find(|a| a.key == field.key).map(|a| &a.value)
}

fn is_yes(value: Option<&AttrValue>) -> bool {
    matches!(value, Some(AttrValue::Bool(true))) || matches!(value, Some(AttrValue::Text(t)) if t == "true")
}

fn text_of(value: Option<&AttrValue>) -> Option<String> {
    match value {
        Some(AttrValue::Text(t)) if !t.trim().is_empty() => Some(t.trim().to_string()),
        _ => None,
    }
}

fn project_label(entry: &ReportEntry) -> String {
    if entry.jira_project_name.is_empty() {
        entry.jira_project_key.clone()
    } else {
        format!("{} ({})", entry.jira_project_name, entry.jira_project_key)
    }
}

fn connection_label(entry: &ReportEntry) -> String {
    if entry.connection.name.is_empty() { entry.connection.jira.base_url.clone() } else { entry.connection.name.clone() }
}

fn grouping_label(entry: &ReportEntry, key: &str, config: &AppConfig, polish: bool) -> String {
    match key {
        "project" => project_label(entry),
        "issue" => format!("{} - {}", entry.worklog.issue_key, entry.worklog.issue_summary),
        "day" => entry.worklog.start_date.clone(),
        "connection" => connection_label(entry),
        // Tempo's "Worklog" level: worklogs sharing a description aggregate.
        "worklog" => {
            let d = entry.worklog.description.trim();
            if !d.is_empty() { d.to_string() } else if polish { "Bez opisu".into() } else { "No description".into() }
        }
        _ => {
            let Some(field) = custom_field(config, key) else { return String::new() };
            if entry.connection.id != field.connection_id {
                return if polish { format!("Nie dotyczy: {}", field.label) } else { format!("Not applicable: {}", field.label) };
            }
            let value = attribute_value(entry, field);
            if field.field_type == "boolean" {
                return if is_yes(value) { field.label.clone() } else { format!("Not {}", field.label) };
            }
            text_of(value).unwrap_or_else(|| if polish { format!("Brak: {}", field.label) } else { format!("No {}", field.label) })
        }
    }
}

fn grouping_name(key: &str, config: &AppConfig) -> String {
    match key {
        "project" => "Space".into(),
        "issue" => "Work Item".into(),
        "day" => "Date".into(),
        "connection" => "Connection".into(),
        "worklog" => "Worklog".into(),
        _ => custom_field(config, key).map(|f| f.label.clone()).unwrap_or_else(|| "Custom field".into()),
    }
}

fn group_tree<'a>(entries: &[&'a ReportEntry], groupings: &[String], config: &AppConfig, polish: bool, depth: usize) -> Vec<GroupNode<'a>> {
    let Some(key) = groupings.get(depth) else { return Vec::new() };
    // Keyed by a case-folded label so the order follows the reader, not byte values.
    let mut buckets: BTreeMap<(String, String), Vec<&'a ReportEntry>> = BTreeMap::new();
    for entry in entries {
        let label = grouping_label(entry, key, config, polish);
        buckets.entry((label.to_lowercase(), label)).or_default().push(entry);
    }
    buckets
        .into_iter()
        .map(|((_, label), grouped)| GroupNode {
            seconds: seconds_of(&grouped),
            children: group_tree(&grouped, groupings, config, polish, depth + 1),
            label,
            entries: grouped,
        })
        .collect()
}

fn render_summary_rows(nodes: &[GroupNode], depth: usize, request: &ReportRequest) -> String {
    nodes
        .iter()
        .map(|node| {
            format!(
                "<tr class=\"summary-row level-{}\"><td style=\"padding-left:{}px\">{}</td><td>{}</td></tr>{}",
                depth.min(4),
                depth * 10,
                escape_html(&node.label),
                format_time(node.seconds, &request.time_format),
                render_summary_rows(&node.children, depth + 1, request)
            )
        })
        .collect()
}

fn column_name(key: &str, config: &AppConfig, polish: bool) -> String {
    match key {
        "date" => (if polish { "Data" } else { "Date" }).into(),
        "project" => "Space".into(),
        "issue" => "Work Item".into(),
        "description" => (if polish { "Opis pracy" } else { "Description" }).into(),
        "connection" => "Connection".into(),
        _ => custom_field(config, key).map(|f| f.label.clone()).unwrap_or_else(|| "Custom field".into()),
    }
}

fn column_value(entry: &ReportEntry, key: &str, config: &AppConfig, polish: bool) -> String {
    match key {
        "date" => entry.worklog.start_date.clone(),
        "project" => project_label(entry),
        "issue" => format!("{} - {}", entry.worklog.issue_key, entry.worklog.issue_summary),
        "description" => if entry.worklog.description.is_empty() { "-".into() } else { entry.worklog.description.clone() },
        "connection" => connection_label(entry),
        _ => {
            let Some(field) = custom_field(config, key) else { return "-".into() };
            let value = attribute_value(entry, field);
            if field.field_type == "boolean" {
                return match (is_yes(value), polish) {
                    (true, true) => "Tak",
                    (true, false) => "Yes",
                    (false, true) => "Nie",
                    (false, false) => "No",
                }
                .into();
            }
            text_of(value).unwrap_or_else(|| "-".into())
        }
    }
}

fn render_detail_entries(entries: &[&ReportEntry], columns: &[String], request: &ReportRequest, config: &AppConfig, polish: bool) -> String {
    entries
        .iter()
        .map(|entry| {
            let cells: String = columns
                .iter()
                .map(|c| {
                    let class = if c == "date" { "nowrap" } else { "" };
                    format!("<td class=\"{class}\">{}</td>", escape_html(&column_value(entry, c, config, polish)))
                })
                .collect();
            format!(
                "<tr class=\"detail-entry\">{cells}<td class=\"logged\">{}</td></tr>",
                format_time(entry.worklog.time_spent_seconds, &request.time_format)
            )
        })
        .collect()
}

fn render_detailed_nodes(nodes: &[GroupNode], depth: usize, columns: &[String], request: &ReportRequest, config: &AppConfig, polish: bool) -> String {
    nodes
        .iter()
        .map(|node| {
            let heading = format!(
                "<tr class=\"detail-group level-{}\"><td colspan=\"{}\"><span style=\"margin-left:{}px\">{}</span></td><td class=\"logged\">{}</td></tr>",
                depth.min(4),
                columns.len(),
                depth * 10,
                escape_html(&node.label),
                format_time(node.seconds, &request.time_format)
            );
            let content = if node.children.is_empty() {
                render_detail_entries(&node.entries, columns, request, config, polish)
            } else {
                render_detailed_nodes(&node.children, depth + 1, columns, request, config, polish)
            };
            format!("{heading}{content}")
        })
        .collect()
}

pub fn render(entries: &[ReportEntry], request: &ReportRequest, range: &MonthRange, config: &AppConfig, footer_left: &str) -> String {
    let polish = config.language == "pl";
    let (period, total_label, logged, entries_label, days, connections, no_entries) = if polish {
        ("Okres", "Łącznie zalogowano", "Zalogowano", "Wpisy", "Dni z wpisami", "Połączenia", "Brak wpisów czasu w wybranym okresie.")
    } else {
        ("Period", "Total Logged", "Logged", "Entries", "Days with entries", "Connections", "No time entries in the selected period.")
    };
    let refs: Vec<&ReportEntry> = entries.iter().collect();
    let total = seconds_of(&refs);
    let accent_ok = request.accent_color.len() == 7
        && request.accent_color.starts_with('#')
        && request.accent_color[1..].chars().all(|c| c.is_ascii_hexdigit());
    let accent = if accent_ok { request.accent_color.as_str() } else { "#172b4d" };
    let tree = group_tree(&refs, &request.groupings, config, polish, 0);
    let summary_heading = if request.groupings.is_empty() {
        (if polish { "Wszystkie wpisy" } else { "All entries" }).to_string()
    } else {
        request.groupings.iter().map(|k| grouping_name(k, config)).collect::<Vec<_>>().join(" / ")
    };
    let summary_rows = if entries.is_empty() {
        format!("<tr><td class=\"empty\" colspan=\"2\">{no_entries}</td></tr>")
    } else if !request.groupings.is_empty() {
        render_summary_rows(&tree, 0, request)
    } else {
        format!("<tr class=\"summary-row level-0\"><td>{summary_heading}</td><td>{}</td></tr>", format_time(total, &request.time_format))
    };
    let columns: Vec<String> = if request.columns.is_empty() { vec!["issue".into(), "description".into()] } else { request.columns.clone() };
    let detail_rows = if entries.is_empty() {
        format!("<tr><td class=\"empty\" colspan=\"{}\">{no_entries}</td></tr>", columns.len() + 1)
    } else if !request.groupings.is_empty() {
        render_detailed_nodes(&tree, 0, &columns, request, config, polish)
    } else {
        render_detail_entries(&refs, &columns, request, config, polish)
    };
    let title = request.title.trim();
    let paper = if request.orientation == "landscape" { "A4 landscape" } else { "A4 portrait" };
    let distinct_days: HashSet<&String> = entries.iter().map(|e| &e.worklog.start_date).collect();
    let distinct_connections: HashSet<&String> = entries.iter().map(|e| &e.connection.id).collect();
    let time = |s: i64| format_time(s, &request.time_format);

    let footer_left_css = if footer_left.is_empty() { String::new() } else { format!("@bottom-left {{ content: {}; }}", css_string(footer_left)) };
    let footer_right_css = if request.show_page_numbers { "@bottom-right { content: \"Page \" counter(page) \" of \" counter(pages); }".to_string() } else { String::new() };

    let head_title = if title.is_empty() { format!("Tempo report {}", request.month) } else { title.to_string() };
    let title_html = if title.is_empty() { "<span></span>".to_string() } else { format!("<h1 class=\"report-title\">{}</h1>", escape_html(title)) };
    let metrics = if request.include_summary {
        format!(
            "<section class=\"metrics\"><div class=\"metric\"><span>{total_label}</span><strong>{}</strong></div><div class=\"metric\"><span>{entries_label}</span><strong>{}</strong></div><div class=\"metric\"><span>{days}</span><strong>{}</strong></div><div class=\"metric\"><span>{connections}</span><strong>{}</strong></div></section>",
            time(total),
            entries.len(),
            distinct_days.len(),
            distinct_connections.len()
        )
    } else {
        String::new()
    };
    let table = if request.layout == "summary" {
        format!("<table><thead><tr><th>{}</th><th>{logged}</th></tr></thead><tbody>{summary_rows}</tbody></table>", escape_html(&summary_heading))
    } else {
        let headers: String = columns.iter().map(|c| format!("<th>{}</th>", escape_html(&column_name(c, config, polish)))).collect();
        format!("<table class=\"detail-table\"><thead><tr>{headers}<th>{logged}</th></tr></thead><tbody>{detail_rows}</tbody></table>")
    };

    format!(
        r#"<!doctype html>
<html lang="{lang}">
<head>
<meta charset="utf-8">
<title>{head_title}</title>
<style>
  @page {{ size: {paper}; margin: 14mm 14mm 18mm;
    {footer_left_css}
    {footer_right_css}
  }}
  @page {{ @bottom-left {{ color: #333; font: 8px Arial, sans-serif; }} @bottom-right {{ color: #333; font: 8px Arial, sans-serif; }} }}
  * {{ box-sizing: border-box; }}
  html {{ -webkit-print-color-adjust: exact; print-color-adjust: exact; }}
  body {{ margin: 0; color: #111; background: #fff; font: 9px/1.4 Arial, "Noto Sans", sans-serif; }}
  .report-head {{ display: flex; justify-content: space-between; align-items: flex-end; min-height: 46px; }}
  .report-title {{ margin: 0; max-width: 55%; font-size: 19px; line-height: 1.15; color: var(--accent); }}
  .report-meta {{ margin-left: auto; text-align: right; font-size: 12px; }}
  .report-meta strong {{ font-size: 10px; }}
  .top-rule {{ margin: 5px 0 0; border-top: 2px solid var(--accent); }}
  .metrics {{ display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; margin: 10px 0; }}
  .metric {{ border: 1px solid #ddd; border-radius: 5px; padding: 7px 9px; }}
  .metric span {{ display: block; color: #666; font-size: 7px; text-transform: uppercase; letter-spacing: .4px; }}
  .metric strong {{ display: block; margin-top: 2px; color: var(--accent); font-size: 14px; }}
  table {{ width: 100%; border-collapse: collapse; table-layout: auto; }}
  thead {{ display: table-header-group; }}
  th {{ padding: 5px 0; border-bottom: 1px solid #111; text-align: left; font-weight: 400; }}
  th:last-child {{ width: 64px; text-align: right; }}
  tr {{ break-inside: avoid; }}
  td {{ vertical-align: top; overflow-wrap: anywhere; }}
  .logged {{ width: 64px; text-align: right; white-space: nowrap; }}
  .summary-row td {{ padding-top: 6px; padding-bottom: 2px; font-size: 9px; }}
  .summary-row.level-0 td {{ padding-top: 8px; padding-bottom: 5px; border-bottom: 1px solid #aaa; font-weight: 700; }}
  .summary-row.level-1 td {{ padding-top: 5px; font-size: 9px; }}
  .summary-row.level-2 td, .summary-row.level-3 td, .summary-row.level-4 td {{ font-size: 8.7px; }}
  .detail-entry td {{ padding: 5px 6px 5px 0; border-bottom: 1px solid #e5e5e5; }}
  .detail-entry td:last-child {{ padding-right: 0; }}
  .detail-group td {{ padding: 7px 0 4px; color: var(--accent); font-weight: 700; border-bottom: 1px solid color-mix(in srgb, var(--accent) 32%, #ddd); }}
  .detail-group.level-1 td, .detail-group.level-2 td {{ padding-top: 5px; font-weight: 600; }}
  .nowrap {{ white-space: nowrap; }}
  .empty {{ padding: 24px; text-align: center; color: #666; }}
</style>
</head>
<body style="--accent:{accent}">
  <header class="report-head">
    {title_html}
    <div class="report-meta">
      {period}: {from} - {to}<br>
      <span>{total_label}: <strong>{total_time}</strong></span>
    </div>
  </header>
  <div class="top-rule"></div>
  {metrics}
  {table}
</body>
</html>"#,
        lang = config.language,
        head_title = escape_html(&head_title),
        from = tempo_date(&range.from_date),
        to = tempo_date(&range.to_date),
        total_time = time(total),
    )
}
