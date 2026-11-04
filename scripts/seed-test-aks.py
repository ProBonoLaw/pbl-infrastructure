"""Seed the replacement Test cluster from the live cluster without copying Secrets.

The target starts with every Deployment at zero replicas and every CronJob
suspended. Ingresses are deliberately excluded so the old controller keeps
the production Test DNS records until cutover. Resource data stays in memory.
"""

import argparse
import json
import subprocess
import sys


SOURCE_CONTEXT = "probono-law-aks-test"
NAMESPACES = (
    "account-operations",
    "aimie-operations",
    "billing-operations",
    "email-operations",
    "file-operations",
)
KINDS = (
    "serviceaccount",
    "secretproviderclass",
    "configmap",
    "service",
    "networkpolicy",
    "deployment",
    "cronjob",
)


def kubectl(context, *args, input_data=None):
    result = subprocess.run(
        ["kubectl", "--context", context, *args],
        input=input_data,
        text=True,
        capture_output=True,
        check=False,
    )
    if result.returncode:
        raise RuntimeError(f"kubectl {args[0]} failed: {result.stderr.strip()}")
    return result.stdout


def confirm_context(context):
    config = json.loads(kubectl(context, "config", "view", "--minify", "-o", "json"))
    contexts = config.get("contexts", [])
    if len(contexts) != 1 or contexts[0]["name"] != context:
        raise RuntimeError(f"Unexpected Kubernetes context: {context}")
    if contexts[0]["context"]["cluster"] != context:
        raise RuntimeError(f"Unexpected cluster for Kubernetes context: {context}")


def clean(item):
    kind = item["kind"]
    metadata = item["metadata"]
    annotations = {
        key: value
        for key, value in metadata.get("annotations", {}).items()
        if key != "kubectl.kubernetes.io/last-applied-configuration"
    }
    clean_metadata = {
        "name": metadata["name"],
        "namespace": metadata["namespace"],
    }
    if metadata.get("labels"):
        clean_metadata["labels"] = metadata["labels"]
    if annotations:
        clean_metadata["annotations"] = annotations
    output = {
        "apiVersion": item["apiVersion"],
        "kind": kind,
        "metadata": clean_metadata,
    }
    if kind == "ConfigMap":
        output["data"] = item.get("data", {})
        if item.get("binaryData"):
            output["binaryData"] = item["binaryData"]
    elif kind == "ServiceAccount":
        if item.get("automountServiceAccountToken") is not None:
            output["automountServiceAccountToken"] = item[
                "automountServiceAccountToken"
            ]
    else:
        spec = item["spec"]
        if kind == "Service":
            for field in (
                "clusterIP",
                "clusterIPs",
                "ipFamilies",
                "ipFamilyPolicy",
                "healthCheckNodePort",
            ):
                spec.pop(field, None)
            for port in spec.get("ports", []):
                port.pop("nodePort", None)
        elif kind == "Deployment":
            spec["replicas"] = 0
        elif kind == "CronJob":
            spec["suspend"] = True
        output["spec"] = spec
    return output


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--apply", action="store_true", help="Apply the paused snapshot to the replacement"
    )
    parser.add_argument(
        "--target-context",
        required=True,
        help="Kubernetes context for the replacement Test AKS cluster",
    )
    args = parser.parse_args()
    target_context = args.target_context
    if not target_context.startswith("probono-law-aks-test-"):
        raise RuntimeError("Target must be a named replacement Test AKS context")
    confirm_context(SOURCE_CONTEXT)
    confirm_context(target_context)

    items = []
    for namespace in NAMESPACES:
        items.append(
            {
                "apiVersion": "v1",
                "kind": "Namespace",
                "metadata": {"name": namespace},
            }
        )
    counts = {}
    for kind in KINDS:
        for namespace in NAMESPACES:
            source = json.loads(
                kubectl(SOURCE_CONTEXT, "get", kind, "-n", namespace, "-o", "json")
            )
            for item in source.get("items", []):
                if item["metadata"]["name"] in (
                    "default",
                    "kube-root-ca.crt",
                ):
                    continue
                items.append(clean(item))
                counts[kind] = counts.get(kind, 0) + 1

    print("Snapshot:", ", ".join(f"{kind}={count}" for kind, count in counts.items()))
    print("Deployments will be paused; CronJobs suspended; Ingresses and Secrets excluded.")
    if not args.apply:
        print("Pass --apply after reviewing the source and target contexts.")
        return
    namespaces = {"apiVersion": "v1", "kind": "List", "items": items[: len(NAMESPACES)]}
    resources = {"apiVersion": "v1", "kind": "List", "items": items[len(NAMESPACES) :]}
    kubectl(target_context, "apply", "-f", "-", input_data=json.dumps(namespaces))
    kubectl(target_context, "apply", "-f", "-", input_data=json.dumps(resources))
    print(f"Applied {len(items)} paused resources to {target_context}.")


if __name__ == "__main__":
    try:
        main()
    except (KeyError, RuntimeError, subprocess.SubprocessError) as exc:
        print(exc, file=sys.stderr)
        sys.exit(1)
