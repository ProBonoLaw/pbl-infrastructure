#!/usr/bin/env bash
set -euo pipefail

: "${AZURE_SUBSCRIPTION_ID:?Set AZURE_SUBSCRIPTION_ID}"

resource_group="probono-law-aks-production"
cluster_name="probono-law-aks-prod"
workspace_id="/subscriptions/${AZURE_SUBSCRIPTION_ID}/resourceGroups/${resource_group}/providers/Microsoft.Monitor/accounts/probono-law-aks-prod-amw"
cluster_id="/subscriptions/${AZURE_SUBSCRIPTION_ID}/resourceGroups/${resource_group}/providers/Microsoft.ContainerService/managedClusters/${cluster_name}"
associations_url="https://management.azure.com${cluster_id}/providers/Microsoft.Insights/dataCollectionRuleAssociations?api-version=2023-03-11"

az resource show --ids "$workspace_id" --api-version 2023-04-03 --output none

rule_id="$(az rest --method get \
  --url "$associations_url" \
  --query "value[?name=='ContainerInsightsMetricsExtension'].properties.dataCollectionRuleId | [0]" --output tsv)"

if [[ -z "$rule_id" || "$rule_id" == "None" ]]; then
  enabled="$(az aks show --subscription "$AZURE_SUBSCRIPTION_ID" \
    --resource-group "$resource_group" --name "$cluster_name" \
    --query azureMonitorProfile.metrics.enabled --output tsv)"
  if [[ "${enabled,,}" == "true" ]]; then
    # A metrics flag alone installs collectors but does not create a workspace association.
    az aks update --subscription "$AZURE_SUBSCRIPTION_ID" \
      --resource-group "$resource_group" --name "$cluster_name" \
      --disable-azure-monitor-metrics --only-show-errors --output none
  fi
  az aks update --subscription "$AZURE_SUBSCRIPTION_ID" \
    --resource-group "$resource_group" --name "$cluster_name" \
    --enable-azure-monitor-metrics \
    --azure-monitor-workspace-resource-id "$workspace_id" \
    --only-show-errors --output none
  rule_id="$(az rest --method get \
    --url "$associations_url" \
    --query "value[?name=='ContainerInsightsMetricsExtension'].properties.dataCollectionRuleId | [0]" --output tsv)"
fi

actual_workspace_id="$(az rest --method get \
  --url "https://management.azure.com${rule_id}?api-version=2023-03-11" \
  --query 'properties.destinations.monitoringAccounts[0].accountResourceId' --output tsv)"
if [[ "${actual_workspace_id,,}" != "${workspace_id,,}" ]]; then
  echo "Production Prometheus data collection rule targets an unexpected workspace." >&2
  exit 1
fi

echo "Production AKS managed Prometheus is associated with its workspace."
