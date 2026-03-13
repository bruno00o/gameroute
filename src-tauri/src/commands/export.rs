use super::CommandError;
use std::path::PathBuf;

#[tauri::command]
pub async fn write_export_file(path: String, content: String) -> Result<(), CommandError> {
    let file_path = PathBuf::from(&path);

    if let Some(parent) = file_path.parent() {
        if !parent.exists() {
            return Err(CommandError::validation("Parent directory does not exist"));
        }
    }

    tokio::fs::write(&file_path, content.as_bytes())
        .await
        .map_err(|e| CommandError::internal(format!("Failed to write file: {}", e)))
}
