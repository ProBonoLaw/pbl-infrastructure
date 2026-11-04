import * as pulumi from "@pulumi/pulumi";
import { authorization, cosmosdb, resources, web } from "@pulumi/azure-native";
import { armGuid, armUniqueString } from "../naming";

export const roleIds = {
  blobOwner: "b7e6dc6d-f1e8-4753-8033-0f276bb0955b",
  blobContributor: "ba92f5b4-2d11-453d-a403-e96b0029c9fe",
  blobReader: "2a2b9908-6ea1-4ae2-8e65-a410df84e7d1",
  queueContributor: "974c5e8b-45b9-4653-ba55-5f855dd0fb88",
  tableContributor: "0a9a7e1f-b9d0-4cc4-a60d-0319b160aaa3",
  secretsOfficer: "b86a8fe4-44ce-4948-aee5-eccb2c155cd7",
  secretsUser: "4633458b-17de-408a-b874-0445c86b69e6",
  certificateOfficer: "a4417e6f-fecd-4de8-b567-7b0420556985",
  eventSender: "2b629674-e913-4c01-ae53-ef4638d8f975",
  eventReceiver: "a638d3c7-ab3a-418d-83e6-5f17a39d4fde",
  reader: "acdd72a7-3385-48ef-bd42-f606fba81ae7",
  insightsReader: "acdd72a7-3385-48ef-bd42-f606fba81ae7",
  analyticsReader: "73c42c96-874c-492b-b04d-ab87d138a893",
  grafanaEditor: "a79a5197-3a5c-4973-a920-486035ffd60f",
  searchIndexDataContributor: "8ebe5a00-799e-43f5-93ac-243d3dce84a7",
  searchIndexDataReader: "1407120a-92aa-4202-b7e9-c0e197c71c8f",
  searchServiceContributor: "7ca78c08-252a-4471-8644-bb5ff32d4ba0",
  networkContributor: "4d97b98b-1d4f-4787-a291-c67834d212e7",
  privateDnsZoneContributor: "b12aa53e-6015-4669-85d0-8515ebb3ae7f",
  acrPull: "7f951dda-4ed3-4680-a7ca-43fe172d538d",
  aksClusterAdmin: "b1ff04bb-8a4e-4dc4-8eb5-8693973ce19b",
  aksContributor: "ed7f3fbd-7b88-4dd4-9017-9adb7ce333f8",
  contributor: "b24988ac-6180-42a0-ab88-20f7382dd24c",
  userAccessAdministrator: "18d7d88d-d35e-4fb5-a5c3-7773c20a72d9",
} as const;

export function principal(app: web.WebApp) {
  return app.identity.apply((identity) => {
    if (!identity?.principalId)
      throw new Error(`Managed identity is missing for ${app.name}`);
    return identity.principalId;
  });
}

export function assign(
  name: string,
  scope: pulumi.Input<string>,
  principalId: pulumi.Input<string>,
  roleDefinitionId: pulumi.Input<string>,
  principalType: authorization.RoleAssignmentArgs["principalType"] = "ServicePrincipal",
  importExistingId?: string,
) {
  const roleAssignmentName = importExistingId
    ? importExistingId.split("/").pop()!
    : armGuid(`rbac-${name}`, scope, principalId, roleDefinitionId);
  return new authorization.RoleAssignment(
    name,
    {
      // Azure's role-assignment API returns resource group scopes with this
      // casing, while ResourceGroup.id uses `resourceGroups`. Preserve the
      // imported scope without changing the original GUID input below.
      scope: pulumi
        .output(scope)
        .apply((value) =>
          /\/resourceGroups\/[^/]+$/i.test(value)
            ? value.replace(/\/resourceGroups\//i, "/resourcegroups/")
            : value,
        ),
      principalId,
      roleDefinitionId,
      roleAssignmentName,
      principalType,
    },
    importExistingId ? { import: importExistingId } : undefined,
  );
}

export function grant(
  subscriptionId: pulumi.Input<string>,
  name: string,
  scope: pulumi.Input<string>,
  app: web.WebApp,
  roleId: string,
) {
  return assign(
    name,
    scope,
    principal(app),
    pulumi.interpolate`${subscriptionId}/providers/Microsoft.Authorization/roleDefinitions/${roleId}`,
  );
}

export function cosmosContributor(
  name: string,
  account: cosmosdb.DatabaseAccount,
  group: resources.ResourceGroup,
  app: web.WebApp,
) {
  const principalId = principal(app);
  const roleDefinitionId = pulumi.interpolate`${account.id}/sqlRoleDefinitions/00000000-0000-0000-0000-000000000002`;
  return new cosmosdb.SqlResourceSqlRoleAssignment(name, {
    accountName: account.name,
    resourceGroupName: group.name,
    roleAssignmentId: armGuid(
      `cosmos-${name}`,
      account.id,
      principalId,
      roleDefinitionId,
    ),
    roleDefinitionId,
    principalId,
    scope: account.id,
  });
}

export function createVideoIndexerTokenRole(
  subscriptionId: pulumi.Input<string>,
  environmentName: string,
  importExistingId?: string,
) {
  const roleDefinitionId = importExistingId
    ? importExistingId.split("/").pop()!
    : armGuid(
        "video-indexer-token-generator-role",
        subscriptionId,
        "data-integrity-extractor-video-indexer-access-token-generator",
      );
  return new authorization.RoleDefinition(
    "video-indexer-token-generator-role",
    {
      scope: subscriptionId,
      roleDefinitionId,
      roleName:
        environmentName === "Test"
          ? "Video Indexer Access Token Generator"
          : pulumi.interpolate`Video Indexer Access Token Generator - ${armUniqueString("subscription", subscriptionId)}`,
      description:
        "Allows the data integrity extractor to read the Video Indexer account and generate access tokens.",
      roleType: "CustomRole",
      permissions: [
        {
          actions: [
            "Microsoft.VideoIndexer/accounts/read",
            "Microsoft.VideoIndexer/accounts/generateAccessToken/action",
          ],
        },
      ],
      assignableScopes: [subscriptionId],
    },
    importExistingId ? { import: importExistingId } : undefined,
  );
}
