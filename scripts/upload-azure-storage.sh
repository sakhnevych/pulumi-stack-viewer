#!/bin/bash
# Script to upload the web application and Pulumi stack state to Azure Blob Storage.
#
# Install the Azure CLI extension to work with the storage account
# az extension add --name storage-preview

function initial_upload_web_application() {
  if [[ $# != 2 ]]; then
    echo "initial_upload_web_application: azure_storage_account_name web_app_source_local_path"
    return 1
  fi

  local _azure_storage_account_name=${1}
  local _web_app_source_local_path=${2}

  # DEFAULT VALUES
  local _azure_container="\$web"

  # upload application to the Azure Blob Storage
  _upload_to_azure_storage    "${_azure_storage_account_name}" "${_azure_container}" "${_web_app_source_local_path}/*" "."

  return 0
}

function upload_pulumi_stack_state() {
  if [[ $# != 3 ]]; then
    echo "upload_pulumi_stack_state: azure_storage_account_name project environment"
    return 1
  fi

  local _azure_storage_account_name=${1}
  local _project=${2}
  local _environment=${3}

  # DEFAULT VALUES
  local _azure_container="\$web"
  local _destination_path="state"
  local _upload_path="${_destination_path}/${_project}/${_environment}"

  mkdir -p "output"
  pulumi stack export --file "output/stack.json"
  DATETIME=$(jq ".deployment.manifest.time" "output/stack.json" | awk -F"T|:" '{print $1"_"$2"-"$3}' | sed 's/"//g')

  # create output folder with the stack data
  mkdir -p "output/${DATETIME}"
  cp "output/stack.json" "output/${DATETIME}/stack.json"
  pulumi stack > "output/${DATETIME}/stack.txt"
  pulumi preview --diff --expect-no-changes --show-sames --show-config > "output/${DATETIME}/preview.txt"

  # upload state to the Azure Blob Storage
  _upload_to_azure_storage    "${_azure_storage_account_name}" "${_azure_container}" "output/${DATETIME}" "${_upload_path}"
  _write_to_remote_azure_file "${_azure_storage_account_name}" "${_azure_container}" "${_upload_path}/latest.txt" "${DATETIME}" "false"
  _write_to_remote_azure_file "${_azure_storage_account_name}" "${_azure_container}" "${_upload_path}/history.txt" "${DATETIME}" "true"

  # clean up
  rm -rf "output/${DATETIME}"

  return 0
}

function _upload_to_azure_storage() {
  local _azure_storage_account_name=${1}
  local _azure_container=${2}
  local _source_local_path=${3}
  local _destination_remote_path=${4}

  az storage blob directory upload \
      --account-name "${_azure_storage_account_name}" \
      --container "${_azure_container}" \
      --source "${_source_local_path}" \
      --destination-path "${_destination_remote_path}" \
      --recursive \
      --only-show-errors
}

function _write_to_remote_azure_file() {
  local _azure_storage_account_name=${1}
  local _azure_container=${2}
  local _remove_file=${3}
  local _content=${4}
  local _append=${5}

  _tmp_local_file=$(mktemp)

  # Download existing blob to local file
  if "${_append}"; then
    az storage blob download \
        --account-name "${_azure_storage_account_name}" \
        --container-name "${_azure_container}" \
        --name "${_remove_file}" \
        --file "${_tmp_local_file}" \
        --only-show-errors
  fi

  # Append data to local file
  echo "${_content}" >> "${_tmp_local_file}"

  # Upload updated file back to blob storage
  az storage blob upload \
      --account-name "${_azure_storage_account_name}" \
      --container-name "${_azure_container}" \
      --name "${_remove_file}" \
      --file "${_tmp_local_file}" \
      --type block \
      --overwrite \
      --only-show-errors
}
