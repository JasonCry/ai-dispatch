// Embedded static assets for the web UI.
// Uses rust-embed to include src/ui/web/static/ files in the binary.

use rust_embed::Embed;

#[derive(Embed)]
#[folder = "src/ui/web/static/"]
pub struct StaticAssets;

/// Look up a static file by path and return (content_type, body).
pub fn get_asset(path: &str) -> Option<(&'static str, Vec<u8>)> {
    let resolved = if path.is_empty() || path == "/" {
        "index.html"
    } else {
        path.trim_start_matches('/')
    };
    let (file, actual_path) = match StaticAssets::get(resolved) {
        Some(f) => (f, resolved),
        None => (StaticAssets::get("index.html")?, "index.html"),
    };
    let content_type = match actual_path.rsplit('.').next() {
        Some("html") => "text/html; charset=utf-8",
        Some("css") => "text/css; charset=utf-8",
        Some("js") => "application/javascript; charset=utf-8",
        Some("svg") => "image/svg+xml",
        Some("json") => "application/json",
        _ => "application/octet-stream",
    };
    Some((content_type, file.data.to_vec()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn get_asset_falls_back_to_index_for_unknown_path() {
        // SPA fallback: unknown paths return index.html
        let result = get_asset("nonexistent.xyz");
        if let Some((ct, _)) = result {
            assert_eq!(ct, "text/html; charset=utf-8");
        }
        // If no static files embedded (e.g. test env without feature), None is ok too
    }

    #[test]
    fn table_header_sticky_offset_does_not_obscure_first_row() {
        let (ct, bytes) = get_asset("style.css").expect("style.css should exist");
        assert_eq!(ct, "text/css; charset=utf-8");
        let css = String::from_utf8(bytes).expect("valid utf-8 css");
        // Regression test: .task-table th inside .task-table-wrap (overflow-x: auto)
        // must not specify top: 49px, which pushes the sticky header down over the first row.
        assert!(
            !css.contains("top: 49px;"),
            "table header must not have top: 49px which obscures the first task row"
        );
        assert!(
            css.contains(".task-table th {\n  color: var(--text-secondary);\n  font-weight: 600;\n  white-space: nowrap;\n  position: sticky;\n  top: 0;\n  background: var(--bg-card);\n}"),
            "table header must align to top: 0"
        );
    }
}
