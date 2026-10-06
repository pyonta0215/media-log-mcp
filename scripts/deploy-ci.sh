#!/bin/sh
# GitHub Actions 用のデプロイ: dist/ を作り、CloudFormation の変更セットで media-log-mcp スタックを更新する。
#
#   ARTIFACTS_BUCKET=<SAM 管理のバケット> sh scripts/deploy-ci.sh
#
# 手元の `npm run deploy`（sam deploy）は samconfig.toml の McpPath（秘匿パス）を渡して更新するが、
# Actions には秘匿パスを置かない。そこで変更セットを直接作り、McpPath と AllowedCidr は
# 現在のスタックの値をそのまま使う（UsePreviousValue）。値を変えたいときは手元から `sam deploy` する。
set -eu
cd "$(dirname "$0")/.."

: "${ARTIFACTS_BUCKET:?ARTIFACTS_BUCKET is required (cloudformation package のアップロード先)}"
STACK="${STACK_NAME:-media-log-mcp}"
CHANGE_SET="gha-${GITHUB_RUN_ID:-$(date +%s)}-${GITHUB_RUN_ATTEMPT:-1}"

sh scripts/build-lambda.sh

mkdir -p build
aws cloudformation package --template-file template.yaml \
  --s3-bucket "$ARTIFACTS_BUCKET" --s3-prefix "$STACK" --output-template-file build/packaged.yaml >/dev/null

aws cloudformation create-change-set --stack-name "$STACK" --change-set-name "$CHANGE_SET" \
  --change-set-type UPDATE --template-body file://build/packaged.yaml --capabilities CAPABILITY_IAM \
  --parameters ParameterKey=McpPath,UsePreviousValue=true ParameterKey=AllowedCidr,UsePreviousValue=true >/dev/null

if ! aws cloudformation wait change-set-create-complete --stack-name "$STACK" --change-set-name "$CHANGE_SET" 2>/dev/null; then
  REASON=$(aws cloudformation describe-change-set --stack-name "$STACK" --change-set-name "$CHANGE_SET" \
    --query StatusReason --output text)
  case "$REASON" in
    *"didn't contain changes"*|*"No updates"*)
      echo "変更なし"
      aws cloudformation delete-change-set --stack-name "$STACK" --change-set-name "$CHANGE_SET"
      exit 0 ;;
    *)
      echo "変更セットを作れなかった: $REASON" >&2
      exit 1 ;;
  esac
fi

aws cloudformation describe-change-set --stack-name "$STACK" --change-set-name "$CHANGE_SET" \
  --query 'Changes[].ResourceChange.[Action,LogicalResourceId,ResourceType,Replacement]' --output table
aws cloudformation execute-change-set --stack-name "$STACK" --change-set-name "$CHANGE_SET"
aws cloudformation wait stack-update-complete --stack-name "$STACK"
echo "デプロイ完了: $STACK"
