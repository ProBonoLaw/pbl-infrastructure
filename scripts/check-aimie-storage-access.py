"""Verify private storage CRUD using an AKS runtime's workload identity.

Run with Python inside a pod using the runtime identity. Creates uniquely named probes,
then deletes them in finally blocks. Never reads application data or uses keys.
"""

import base64
import ipaddress
import json
import socket
import sys
import uuid
from email.utils import formatdate
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from azure.identity import WorkloadIdentityCredential


def main(account):
    if account not in {"aimiedatatestsuffix", "aimiedataprodsuffix",
                       "probonolawdatatestsuffix", "probonolawdataprodsuffix"}:
        raise ValueError("Only the four consolidated storage accounts may be checked")
    endpoints = {}
    for service in ("blob", "queue", "table"):
        hostname = f"{account}.{service}.core.windows.net"
        addresses = sorted({row[4][0] for row in socket.getaddrinfo(hostname, 443)})
        if not addresses or not all(ipaddress.ip_address(ip).is_private for ip in addresses):
            raise RuntimeError(f"{service} does not resolve exclusively to private addresses")
        endpoints[service] = f"https://{hostname}"
        print(json.dumps({"service": service, "privateAddresses": addresses}), flush=True)

    credential = WorkloadIdentityCredential()
    token = credential.get_token("https://storage.azure.com/.default").token

    def request(service, method, path, body=None, extra_headers=None):
        headers = {
            "Authorization": f"Bearer {token}",
            "x-ms-date": formatdate(usegmt=True),
            "x-ms-version": "2020-12-06",
        }
        if service == "table":
            headers.update({"Accept": "application/json;odata=nometadata",
                            "Content-Type": "application/json", "DataServiceVersion": "3.0"})
        headers.update(extra_headers or {})
        try:
            with urlopen(Request(endpoints[service] + path, data=body,
                                 headers=headers, method=method), timeout=30) as response:
                return response.read()
        except HTTPError as error:
            raise RuntimeError(f"{service} {method}: HTTP {error.code}, "
                               f"{error.headers.get('x-ms-error-code', 'storage error')}") from None

    suffix = uuid.uuid4().hex
    name = f"rbac-probe-{suffix}"
    table = f"RbacProbe{suffix}"
    payload = b"rbac-verification"
    created = []
    try:
        request("blob", "PUT", f"/{name}?restype=container", b"")
        created.append(("blob", f"/{name}?restype=container"))
        request("blob", "PUT", f"/{name}/probe", payload, {"x-ms-blob-type": "BlockBlob"})
        if request("blob", "GET", f"/{name}/probe") != payload:
            raise RuntimeError("Blob verification mismatch")
        request("blob", "DELETE", f"/{name}/probe")
        print("Blob create/write/read/delete: PASS", flush=True)

        request("queue", "PUT", f"/{name}", b"")
        created.append(("queue", f"/{name}"))
        encoded = base64.b64encode(payload)
        request("queue", "POST", f"/{name}/messages",
                b"<QueueMessage><MessageText>" + encoded + b"</MessageText></QueueMessage>")
        if encoded not in request("queue", "GET", f"/{name}/messages?peekonly=true"):
            raise RuntimeError("Queue verification mismatch")
        request("queue", "DELETE", f"/{name}/messages")
        print("Queue create/send/peek/clear: PASS", flush=True)

        request("table", "POST", "/Tables", json.dumps({"TableName": table}).encode())
        created.append(("table", f"/Tables('{table}')"))
        entity = {"PartitionKey": "rbac", "RowKey": "probe", "Value": "rbac-verification"}
        request("table", "POST", f"/{table}", json.dumps(entity).encode())
        entity_path = f"/{table}(PartitionKey='rbac',RowKey='probe')"
        actual = json.loads(request("table", "GET", entity_path))
        if any(actual.get(key) != value for key, value in entity.items()):
            raise RuntimeError("Table verification mismatch")
        request("table", "DELETE", entity_path, extra_headers={"If-Match": "*"})
        print("Table create/write/read/delete: PASS", flush=True)
    finally:
        cleanup_errors = []
        for service, path in reversed(created):
            try:
                request(service, "DELETE", path)
            except RuntimeError as error:
                cleanup_errors.append(f"{path}: {error}")
        credential.close()
        if cleanup_errors:
            raise RuntimeError("Probe cleanup failed: " + "; ".join(cleanup_errors))
        print("All created probes deleted", flush=True)
    print(f"{account}: workload identity access verified", flush=True)


if __name__ == "__main__":
    main(sys.argv[1])
