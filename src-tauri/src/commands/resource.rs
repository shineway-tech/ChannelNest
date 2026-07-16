use super::*;

#[tauri::command]
pub(crate) fn create_local_resource(
    app: AppHandle,
    request: CreateLocalResourceRequest,
) -> Result<LocalResource, String> {
    storage::local_store::create_local_resource(&app, request)
}

#[tauri::command]
pub(crate) fn list_local_resources(
    app: AppHandle,
    request: ListLocalResourcesRequest,
) -> Result<Vec<LocalResource>, String> {
    storage::local_store::list_local_resources(&app, request)
}

#[tauri::command]
pub(crate) fn delete_local_resource(
    app: AppHandle,
    request: DeleteLocalResourceRequest,
) -> Result<(), String> {
    storage::local_store::delete_local_resource(&app, request)
}
