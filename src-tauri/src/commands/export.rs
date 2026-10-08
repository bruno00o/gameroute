use super::CommandError;
use std::path::PathBuf;

const PDF_MAGIC: &[u8] = b"%PDF-";

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

#[tauri::command]
pub async fn write_export_pdf(path: String, bytes: Vec<u8>) -> Result<(), CommandError> {
    let file_path = PathBuf::from(&path);

    let is_pdf = file_path
        .extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| ext.eq_ignore_ascii_case("pdf"));
    if !is_pdf {
        return Err(CommandError::validation("Export path must end with .pdf"));
    }
    if !bytes.starts_with(PDF_MAGIC) {
        return Err(CommandError::validation("Content is not a PDF document"));
    }
    if let Some(parent) = file_path.parent() {
        if !parent.exists() {
            return Err(CommandError::validation("Parent directory does not exist"));
        }
    }

    tokio::fs::write(&file_path, &bytes)
        .await
        .map_err(|e| CommandError::internal(format!("Failed to write file: {}", e)))
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &[u8] = b"%PDF-1.3\n%\xff\xff\n1 0 obj\n<<>>\nendobj\ntrailer\n%%EOF\n";

    #[tokio::test]
    async fn writes_pdf_bytes_unchanged() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("report.pdf");

        write_export_pdf(path.to_string_lossy().into_owned(), SAMPLE.to_vec())
            .await
            .unwrap();

        assert_eq!(std::fs::read(&path).unwrap(), SAMPLE);
    }

    #[tokio::test]
    async fn accepts_an_uppercase_extension() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("REPORT.PDF");

        assert!(
            write_export_pdf(path.to_string_lossy().into_owned(), SAMPLE.to_vec())
                .await
                .is_ok()
        );
    }

    #[tokio::test]
    async fn rejects_other_extensions() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("report.exe");

        let err = write_export_pdf(path.to_string_lossy().into_owned(), SAMPLE.to_vec())
            .await
            .unwrap_err();

        assert_eq!(err.code, "VALIDATION_ERROR");
        assert!(!path.exists());
    }

    #[tokio::test]
    async fn rejects_content_that_is_not_a_pdf() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("report.pdf");

        let err = write_export_pdf(path.to_string_lossy().into_owned(), b"MZ\x90\x00".to_vec())
            .await
            .unwrap_err();

        assert_eq!(err.code, "VALIDATION_ERROR");
        assert!(!path.exists());
    }

    #[tokio::test]
    async fn rejects_a_missing_directory() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("missing").join("report.pdf");

        let err = write_export_pdf(path.to_string_lossy().into_owned(), SAMPLE.to_vec())
            .await
            .unwrap_err();

        assert_eq!(err.code, "VALIDATION_ERROR");
    }
}
