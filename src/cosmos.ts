import * as pulumi from "@pulumi/pulumi";
import { authorization, cosmosdb, resources } from "@pulumi/azure-native";
import { armUniqueString } from "./naming";

const containerDefinitions = [
  { name: "accounts", paths: ["/accountId"], fullText: false },
  {
    name: "accountUsage",
    paths: ["/accountId"],
    fullText: true,
  },
  {
    name: "aimieStats",
    paths: ["/accountId", "/name"],
    fullText: true,
  },
  {
    name: "messages2",
    paths: ["/account_id", "/thread_id"],
    fullText: true,
  },
  {
    name: "notices",
    paths: ["/oid", "/notificationType"],
    fullText: true,
  },
  { name: "requests", paths: ["/accountId"], fullText: true },
  {
    name: "clientFeedbackRequests",
    paths: ["/accountId"],
    fullText: true,
  },
  {
    name: "feedback",
    paths: ["/oid", "/accountId"],
    fullText: true,
  },
] as const;

type ContainerDefinition = {
  name: string;
  paths: readonly string[];
  fullText: boolean;
};

export function createCosmos(
  group: resources.ResourceGroup,
  subscriptionId: pulumi.Input<string>,
  environmentName: string,
) {
  // This flag records a completed, staged migration, not a one-step conversion.
  // Run scripts/migrate-cosmos-region.py and verify each phase before enabling it.
  const northCentral =
    new pulumi.Config().getBoolean("cosmosNorthCentral") ?? false;
  const provisioned =
    northCentral ||
    (new pulumi.Config().getBoolean("cosmosProvisioned") ?? false);
  // Preserve account names, endpoints and URNs in both subscriptions. The legacy
  // "sls" / "serverless-pilot" labels are immutable historical identifiers.
  const account = new cosmosdb.DatabaseAccount(
    "db-law-serverless-pilot",
    {
      accountName: pulumi.interpolate`db-law-sls-${armUniqueString("subscription", subscriptionId)}`,
      resourceGroupName: group.name,
      location: "centralus",
      kind: "GlobalDocumentDB",
      databaseAccountOfferType: "Standard",
      capabilities: provisioned ? [] : [{ name: "EnableServerless" }],
      publicNetworkAccess: "Enabled",
      isVirtualNetworkFilterEnabled: false,
      disableLocalAuth: false,
      networkAclBypass: "None",
      consistencyPolicy: {
        defaultConsistencyLevel: "Session",
        maxIntervalInSeconds: 5,
        maxStalenessPrefix: 100,
      },
      locations: [
        {
          locationName: northCentral ? "North Central US" : "Central US",
          failoverPriority: 0,
          isZoneRedundant: northCentral,
        },
      ],
      ipRules: [
        environmentName === "Test" ? "203.0.113.150" : "203.0.113.151",
        ...(environmentName === "Production" ? ["203.0.113.152"] : []),
        "4.210.172.107",
        "13.88.56.148",
        "13.91.105.215",
        "40.91.218.243",
      ].map((ipAddressOrRange) => ({ ipAddressOrRange })),
      backupPolicy: {
        type: "Periodic",
        periodicModeProperties: {
          backupIntervalInMinutes: 240,
          backupRetentionIntervalInHours: 8,
          backupStorageRedundancy: "Geo",
        },
      },
    },
    { protect: true },
  );
  const metadataReader = new cosmosdb.SqlResourceSqlRoleDefinition(
    "cosmos-account-metadata-reader",
    {
      accountName: account.name,
      resourceGroupName: group.name,
      roleDefinitionId: "00000000-0000-4000-8000-000000000018",
      roleName: "Cosmos Metadata and Query Executor",
      type: "CustomRole",
      assignableScopes: [account.id],
      permissions: [
        {
          dataActions: [
            "Microsoft.DocumentDB/databaseAccounts/readMetadata",
            "Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers/executeQuery",
            ...(environmentName === "Test"
              ? [
                  "Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers/items/read",
                ]
              : []),
          ],
        },
      ],
    },
  );
  new cosmosdb.SqlResourceSqlRoleAssignment("cosmos-operator-metadata-access", {
    accountName: account.name,
    resourceGroupName: group.name,
    roleAssignmentId: "00000000-0000-4000-8000-000000000022",
    roleDefinitionId: metadataReader.id,
    principalId: "00000000-0000-4000-8000-000000000001",
    scope: account.id,
  });
  const roleIds =
    environmentName === "Test"
      ? {
          definition: "00000000-0000-4000-8000-000000000023",
          assignment: "00000000-0000-4000-8000-000000000024",
        }
      : {
          definition: "00000000-0000-4000-8000-000000000025",
          assignment: "00000000-0000-4000-8000-000000000026",
        };
  const roleManager = new authorization.RoleDefinition(
    "cosmos-sql-role-manager",
    {
      scope: group.id,
      roleDefinitionId: roleIds.definition,
      roleName:
        environmentName === "Test"
          ? "Cosmos SQL Role Manager"
          : "Cosmos SQL Role Manager - Production",
      description:
        "Read SQL role definitions and read or write SQL role assignments on Cosmos DB accounts.",
      roleType: "CustomRole",
      assignableScopes: [group.id],
      permissions: [
        {
          actions: [
            "Microsoft.DocumentDB/databaseAccounts/sqlRoleDefinitions/read",
            "Microsoft.DocumentDB/databaseAccounts/sqlRoleAssignments/read",
            "Microsoft.DocumentDB/databaseAccounts/sqlRoleAssignments/write",
          ],
        },
      ],
    },
  );
  new authorization.RoleAssignment("cosmos-operator-sql-role-manager", {
    roleAssignmentName: roleIds.assignment,
    scope: account.id,
    roleDefinitionId: roleManager.id,
    principalId: "00000000-0000-4000-8000-000000000001", // platform operator
    principalType: "User",
  });
  const database = new cosmosdb.SqlResourceSqlDatabase(
    "db-conversation-history-serverless-pilot",
    {
      accountName: account.name,
      databaseName: "db_conversation_history",
      resourceGroupName: group.name,
      resource: { id: "db_conversation_history" },
    },
    { protect: true },
  );
  const definitions: ContainerDefinition[] = [
    ...containerDefinitions,
    ...(environmentName === "Production"
      ? [{ name: "billingRuns", paths: ["/accountId"], fullText: false }]
      : []),
  ];
  const containers = Object.fromEntries(
    definitions.map((definition) => [
      definition.name,
      createSqlContainer(
        `cosmos-${definition.name}-serverless-pilot`,
        account,
        database,
        group,
        definition,
      ),
    ]),
  );
  if (northCentral) {
    // Azure Native does not expose the throughputSettings child as a standalone
    // resource. Incremental ARM deployments manage the dedicated autoscale
    // settings after the migration script has converted every container.
    // Test also has an existing application-created billingRuns container. Its
    // contents/schema remain application-owned; its throughput is managed here.
    for (const containerName of [
      ...containerDefinitions.map((c) => c.name),
      "billingRuns",
    ]) {
      const maxThroughput =
        containerName === "messages2"
          ? 5000
          : containerName === "notices"
            ? 2000
            : 1000;
      new resources.Deployment(
        `cosmos-${containerName}-autoscale`,
        {
          deploymentName: `cosmos-${containerName}-autoscale`,
          resourceGroupName: group.name,
          properties: {
            mode: "Incremental",
            template: {
              $schema:
                "https://schema.management.azure.com/schemas/2019-04-01/deploymentTemplate.json#",
              contentVersion: "1.0.0.0",
              resources: [
                {
                  type: "Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers/throughputSettings",
                  apiVersion: "2025-10-15",
                  name: pulumi.interpolate`${account.name}/${database.name}/${containerName}/default`,
                  properties: {
                    resource: { autoscaleSettings: { maxThroughput } },
                  },
                },
              ],
            },
          },
        },
        {
          dependsOn: containers[containerName]
            ? [containers[containerName]]
            : [database],
        },
      );
    }
  }
  return { serverless: { account, database, containers } };
}

function createSqlContainer(
  logicalName: string,
  account: cosmosdb.DatabaseAccount,
  database: cosmosdb.SqlResourceSqlDatabase,
  group: resources.ResourceGroup,
  { name, paths, fullText }: ContainerDefinition,
) {
  return new cosmosdb.SqlResourceSqlContainer(
    logicalName,
    {
      accountName: account.name,
      databaseName: database.name,
      containerName: name,
      resourceGroupName: group.name,
      resource: {
        id: name,
        indexingPolicy: {
          indexingMode: "consistent",
          automatic: true,
          includedPaths: [{ path: "/*" }],
          excludedPaths: [{ path: '/"_etag"/?' }],
        },
        partitionKey: {
          paths: [...paths],
          kind: paths.length === 1 ? "Hash" : "MultiHash",
          version: 2,
        },
        conflictResolutionPolicy: {
          mode: "LastWriterWins",
          conflictResolutionPath: "/_ts",
        },
        fullTextPolicy: fullText ? { defaultLanguage: "en-US" } : undefined,
      },
    },
    {
      protect: true,
      ignoreChanges: [
        "resource.conflictResolutionPolicy.conflictResolutionProcedure",
      ],
    },
  );
}
