use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ProjectType {
    Static,
    Node,
    Files,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DetectionResult {
    pub project_type: ProjectType,
    pub serve_dir_candidates: Vec<String>,
    pub entry_file: Option<String>,
    pub scripts: Option<HashMap<String, String>>,
    pub notes: Vec<String>,
}

const BUILD_DIRS: &[&str] = &["dist", "build", "out", "public", "_site"];

pub fn detect_project(root_dir: &Path) -> DetectionResult {
    let mut notes = Vec::new();

    // Check for package.json (Node.js project)
    let pkg_file = root_dir.join("package.json");
    if pkg_file.exists() {
        match fs::read_to_string(&pkg_file) {
            Ok(content) => {
                match serde_json::from_str::<serde_json::Value>(&content) {
                    Ok(pkg) => {
                        let scripts = pkg.get("scripts")
                            .and_then(|s| serde_json::from_value::<HashMap<String, String>>(s.clone()).ok());

                        notes.push("package.json found. Choose a start script; dependencies install only with your approval.".to_string());

                        return DetectionResult {
                            project_type: ProjectType::Node,
                            serve_dir_candidates: vec![],
                            entry_file: None,
                            scripts,
                            notes,
                        };
                    }
                    Err(_) => {
                        notes.push("package.json exists but is not valid JSON.".to_string());
                    }
                }
            }
            Err(_) => {
                notes.push("package.json exists but cannot be read.".to_string());
            }
        }
    }

    // Check for static HTML projects
    let mut serve_dir_candidates = Vec::new();

    for dir in BUILD_DIRS {
        let index_path = root_dir.join(dir).join("index.html");
        if index_path.exists() {
            serve_dir_candidates.push(dir.to_string());
        }
    }

    // Check root directory
    if root_dir.join("index.html").exists() {
        serve_dir_candidates.insert(0, ".".to_string());
    }

    if !serve_dir_candidates.is_empty() {
        return DetectionResult {
            project_type: ProjectType::Static,
            serve_dir_candidates,
            entry_file: Some("index.html".to_string()),
            scripts: None,
            notes,
        };
    }

    // Default to plain files
    notes.push("No index.html or package.json detected. Hosting as plain files.".to_string());
    DetectionResult {
        project_type: ProjectType::Files,
        serve_dir_candidates: vec![".".to_string()],
        entry_file: None,
        scripts: None,
        notes,
    }
}
