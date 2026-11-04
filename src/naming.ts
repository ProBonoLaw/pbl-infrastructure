import * as pulumi from "@pulumi/pulumi";
import { resources } from "@pulumi/azure-native";

const names = new Map<string, pulumi.Output<string>>();

/**
 * ARM's guid() and uniqueString() have no local Azure Native equivalents.
 * A subscription deployment containing only an output evaluates the Azure
 * function, preserving names already deployed in Azure.
 */
function armName(
  key: string,
  functionName: "guid" | "uniqueString",
  values: pulumi.Input<string>[],
): pulumi.Output<string> {
  const cacheKey = `${functionName}:${key}`;
  const cached = names.get(cacheKey);
  if (cached) return cached;

  const parameters = Object.fromEntries(
    values.map((value, index) => [`value${index}`, { value }]),
  );
  const templateParameters = Object.fromEntries(
    values.map((_, index) => [`value${index}`, { type: "string" }]),
  );
  const args = values
    .map((_, index) => `parameters('value${index}')`)
    .join(", ");
  const deployment = new resources.DeploymentAtSubscriptionScope(
    `arm-name-${functionName}-${key}`,
    {
      deploymentName: `pulumi-name-${key}`
        .replace(/[^a-zA-Z0-9-]/g, "-")
        .slice(0, 64),
      location: "centralus",
      properties: {
        mode: "Incremental",
        parameters,
        template: {
          $schema:
            "https://schema.management.azure.com/schemas/2018-05-01/subscriptionDeploymentTemplate.json#",
          contentVersion: "1.0.0.0",
          parameters: templateParameters,
          resources: [],
          outputs: {
            result: { type: "string", value: `[${functionName}(${args})]` },
          },
        },
      },
    },
  );
  const result = deployment.properties.apply((properties) => {
    const value = properties?.outputs?.result?.value;
    // A targeted update may omit a new naming deployment while Pulumi still
    // evaluates one of its dependents. Keep that name unknown until the
    // deployment is included in an update.
    if (value === undefined || value === null) {
      return pulumi.unknown as unknown as string;
    }
    return String(value);
  });
  names.set(cacheKey, result);
  return result;
}

export function armUniqueString(
  key: string,
  ...values: pulumi.Input<string>[]
): pulumi.Output<string> {
  return armName(key, "uniqueString", values);
}

export function armGuid(
  key: string,
  ...values: pulumi.Input<string>[]
): pulumi.Output<string> {
  return armName(key, "guid", values);
}
