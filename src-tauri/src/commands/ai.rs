use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};
use uuid::Uuid;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SaveGeneratedImageFromUrlRequest {
    request_id: String,
    output_id: String,
    sequence_no: u32,
    download_url: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SaveGeneratedImageResponse {
    path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SaveGeneratedImageToDownloadsRequest {
    source_path: String,
    file_name: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SaveGeneratedImageToDownloadsResponse {
    path: String,
}

#[tauri::command]
pub(crate) async fn save_generated_image_output_from_url(
    app: AppHandle,
    request: SaveGeneratedImageFromUrlRequest,
) -> Result<SaveGeneratedImageResponse, String> {
    let request_id = Uuid::parse_str(&request.request_id)
        .map_err(|_| "生成任务编号无效".to_string())?
        .to_string();
    let output_id = Uuid::parse_str(&request.output_id)
        .map_err(|_| "图片编号无效".to_string())?
        .to_string();
    if request.sequence_no == 0 || request.sequence_no > 9999 {
        return Err("图片序号无效".to_string());
    }
    let url = reqwest::Url::parse(&request.download_url)
        .map_err(|_| "图片下载地址无效".to_string())?;
    if url.scheme() != "https" {
        return Err("图片下载地址无效".to_string());
    }

    let response = reqwest::Client::new()
        .get(url)
        .send()
        .await
        .map_err(|_| "图片下载失败".to_string())?;
    if !response.status().is_success() {
        return Err("图片下载失败".to_string());
    }
    if response
        .content_length()
        .map(|length| length > 60 * 1024 * 1024)
        .unwrap_or(false)
    {
        return Err("图片文件过大".to_string());
    }
    let bytes = response
        .bytes()
        .await
        .map_err(|_| "图片下载失败".to_string())?;
    if bytes.is_empty() || bytes.len() > 60 * 1024 * 1024 {
        return Err("图片文件大小无效".to_string());
    }

    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("generated-images")
        .join(&request_id);
    tokio::fs::create_dir_all(&dir)
        .await
        .map_err(|error| error.to_string())?;

    let path = dir.join(format!("{}-{}.jpg", request.sequence_no, output_id));
    tokio::fs::write(&path, bytes)
        .await
        .map_err(|error| error.to_string())?;

    Ok(SaveGeneratedImageResponse {
        path: path.to_string_lossy().to_string(),
    })
}

#[tauri::command]
pub(crate) async fn save_generated_image_to_downloads(
    app: AppHandle,
    request: SaveGeneratedImageToDownloadsRequest,
) -> Result<SaveGeneratedImageToDownloadsResponse, String> {
    let source = PathBuf::from(request.source_path);
    let source = tokio::fs::canonicalize(source)
        .await
        .map_err(|_| "图片文件不存在".to_string())?;
    let generated_root = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("generated-images");
    let generated_root = tokio::fs::canonicalize(generated_root)
        .await
        .map_err(|error| error.to_string())?;
    if !source.starts_with(&generated_root) {
        return Err("图片文件路径无效".to_string());
    }
    let metadata = tokio::fs::metadata(&source)
        .await
        .map_err(|error| error.to_string())?;
    if !metadata.is_file() {
        return Err("图片文件无效".to_string());
    }

    let downloads = app
        .path()
        .download_dir()
        .map_err(|error| error.to_string())?;
    tokio::fs::create_dir_all(&downloads)
        .await
        .map_err(|error| error.to_string())?;
    let file_name = sanitize_download_file_name(&request.file_name);
    let target = unique_download_path(&downloads, &file_name).await;
    tokio::fs::copy(&source, &target)
        .await
        .map_err(|error| error.to_string())?;

    Ok(SaveGeneratedImageToDownloadsResponse {
        path: target.to_string_lossy().to_string(),
    })
}

fn sanitize_download_file_name(value: &str) -> String {
    let mut normalized = value
        .chars()
        .map(|ch| match ch {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            ch if ch.is_control() => '_',
            ch => ch,
        })
        .collect::<String>()
        .trim_matches(|ch| ch == '.' || ch == ' ')
        .to_string();
    if normalized.is_empty() {
        normalized = "generated-image.jpg".to_string();
    }
    if !normalized.to_ascii_lowercase().ends_with(".jpg") {
        normalized.push_str(".jpg");
    }
    normalized
}

async fn unique_download_path(downloads: &Path, file_name: &str) -> PathBuf {
    let base = Path::new(file_name)
        .file_stem()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .unwrap_or("generated-image");
    let extension = Path::new(file_name)
        .extension()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .unwrap_or("jpg");
    for index in 0..1000_u32 {
        let name = if index == 0 {
            format!("{base}.{extension}")
        } else {
            format!("{base} ({index}).{extension}")
        };
        let candidate = downloads.join(name);
        if tokio::fs::metadata(&candidate).await.is_err() {
            return candidate;
        }
    }
    downloads.join(format!("{base}-{}.{}", Uuid::new_v4(), extension))
}
