#!/usr/bin/env bash
set -euo pipefail

stack=${1:?Pass test or prod}
case "$stack" in
    test)
        cluster_group=probono-law-aks-test-northcentral
        cluster_name=probono-law-aks-test-nc
        ;;
    prod)
        cluster_group=probono-law-aks-production
        cluster_name=probono-law-aks-prod
        ;;
    *)
        echo "Unsupported stack: $stack" >&2
        exit 1
        ;;
esac

: "${AZURE_SUBSCRIPTION_ID:?Set AZURE_SUBSCRIPTION_ID to the selected stack subscription}"

namespace=probonolaw-ui
manifest="${RUNNER_TEMP:-/tmp}/portal-api-bootstrap-$stack.yaml"
cert_manager_manifest=https://github.com/cert-manager/cert-manager/releases/download/v1.21.2/cert-manager.yaml

pulumi login "azblob://$stack"
stack_subscription=$(pulumi config get azure-native:subscriptionId --stack "$stack")
if [[ "$stack_subscription" != "$AZURE_SUBSCRIPTION_ID" ]]; then
    echo "The $stack stack subscription does not match the Azure login" >&2
    exit 1
fi

pwsh -NoProfile -File scripts/render-portal-api-bootstrap.ps1 -Stack "$stack" -ApiNamespace "$namespace" -OutputPath "$manifest"

invoke() {
    local result exit_code
    result=$(az aks command invoke \
        --subscription "$AZURE_SUBSCRIPTION_ID" \
        --resource-group "$cluster_group" \
        --name "$cluster_name" \
        --command "$1" \
        "${@:2}" \
        --output json)
    jq -r '.logs // ""' <<<"$result"
    exit_code=$(jq -r '.exitCode // "missing"' <<<"$result")
    if [[ "$exit_code" != 0 ]]; then
        echo "AKS Run Command failed with exit code $exit_code" >&2
        return 1
    fi
}

authorized=false
for attempt in 1 2 3 4 5 6 7 8 9 10; do
    if invoke "kubectl auth can-i get namespaces | grep -qx yes && kubectl auth can-i create customresourcedefinitions | grep -qx yes"; then
        authorized=true
        break
    fi
    echo "Waiting for AKS Kubernetes RBAC propagation (attempt $attempt of 10)" >&2
    sleep 15
done
if [[ "$authorized" != true ]]; then
    echo "The $stack deployment identity lacks AKS cluster admin permission" >&2
    exit 1
fi

invoke "kubectl apply -f $cert_manager_manifest"
invoke "kubectl wait --for=condition=Available deployment --all -n cert-manager --timeout=60s"
invoke "kubectl create namespace $namespace --dry-run=client -o yaml | kubectl apply -f -"
invoke "kubectl apply -f $(basename "$manifest")" --file "$manifest"
invoke "kubectl wait --for=condition=Available nginxingresscontroller/portal-public --timeout=60s"

ready=false
for attempt in 1 2 3 4 5; do
    if invoke "kubectl wait --for=condition=Ready certificate/portal-api-tls -n $namespace --timeout=60s"; then
        ready=true
        break
    fi
    echo "Certificate is not Ready yet (attempt $attempt of 5)" >&2
done
if [[ "$ready" != true ]]; then
    echo "The $stack portal API certificate did not become Ready" >&2
    exit 1
fi
invoke "kubectl get certificate portal-api-tls -n $namespace -o wide"
invoke "kubectl get secret portal-api-tls -n $namespace -o jsonpath='{.type}'"
