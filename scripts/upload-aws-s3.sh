#!/bin/bash
# Script to upload the web application and Pulumi stack state to AWS S3.
#
# Install the AWS CLI to work with the S3 storage.
#

function initial_upload_web_application() {
  if [[ $# != 2 ]]; then
    echo "initial_upload_web_application: s3_bucket_name web_app_source_local_path"
    return 1
  fi

  local _s3_bucket_name=${1}
  local _web_app_source_local_path=${2}

  # upload application to the AWS S3 bucket
  _upload_to_s3_bucket "${_s3_bucket_name}" "${_web_app_source_local_path}" ""

  return 0
}

function upload_pulumi_stack_state() {
  if [[ $# != 3 ]]; then
    echo "upload_pulumi_stack_state: s3_bucket_name project environment"
    return 1
  fi

  local _s3_bucket_name=${1}
  local _project=${2}
  local _environment=${3}

  # DEFAULT VALUES
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

  # upload state to the AWS S3 bucket
  _upload_to_s3_bucket     "${_s3_bucket_name}" "output/${DATETIME}" "${_upload_path}/${DATETIME}"
  _write_to_remote_s3_file "${_s3_bucket_name}" "${_upload_path}/latest.txt" "${DATETIME}" "false"
  _write_to_remote_s3_file "${_s3_bucket_name}" "${_upload_path}/history.txt" "${DATETIME}" "true"

  # clean up
  rm -rf "output/${DATETIME}"

  return 0
}

function _upload_to_s3_bucket() {
  local _s3_bucket_name=${1}
  local _source_local_path=${2}
  local _destination_remote_path=${3}

  aws s3 cp --recursive \
      "${_source_local_path}" "s3://${_s3_bucket_name}/${_destination_remote_path}"
}

function _write_to_remote_s3_file() {
  local _s3_bucket_name=${1}
  local _remove_file=${2}
  local _content=${3}
  local _append=${4}

  _tmp_local_file=$(mktemp)

  # Download existing file to a local file
  if "${_append}"; then
    aws s3 cp "s3://${_s3_bucket_name}/${_remove_file}" "${_tmp_local_file}"
  fi

  # Append data to the local file
  printf "${_content}%n" >> "${_tmp_local_file}"

  # Upload updated file back to the bucket
  aws s3 cp "${_tmp_local_file}" "s3://${_s3_bucket_name}/${_remove_file}"
}
