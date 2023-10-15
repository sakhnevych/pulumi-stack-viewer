#!/bin/bash
# Script to upload the web application and Pulumi stack state to local destination.

function initial_upload_web_application() {
  if [[ $# != 2 ]]; then
    echo "initial_upload_web_application: web_app_source_path destination_path"
    return 1
  fi

  local _web_app_source_path=${1}
  local _destination_path=${2}

  # upload web application to the destination path
  cp -r "${_web_app_source_path}" "${_destination_path}"

  return 0
}

function upload_pulumi_stack_state() {
  if [[ $# != 3 ]]; then
    echo "upload_pulumi_stack_state: destination_path project environment"
    return 1
  fi

  local _destination_path=${1}
  local _project=${2}
  local _environment=${3}

  # DEFAULT VALUES
  local _upload_path="${_destination_path}/${_project}/${_environment}"

  mkdir -p "output"
  pulumi stack export --file "output/stack.json"
  DATETIME=$(jq ".deployment.manifest.time" "output/stack.json" | awk -F"T|:" '{print $1"_"$2"-"$3}' | sed 's/"//g')

  # create output folder with the stack data
  mkdir -p "output/${DATETIME}"
  cp "output/stack.json" "output/${DATETIME}/stack.json"
  pulumi stack > "output/${DATETIME}/stack.txt"
  pulumi preview --diff --expect-no-changes --show-sames --show-config > "output/${DATETIME}/preview.txt"

  # upload state to the storage
  cp -r "output/${DATETIME}" "${_upload_path}/"
  echo "${DATETIME}" > "${_upload_path}/latest.txt"
  echo "${DATETIME}" >> "${_upload_path}/history.txt"

  # clean up
  rm -rf "output/${DATETIME}"

  return 0
}
