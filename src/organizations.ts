export type Organization = {
  id: string;
  name: string;
  website: string;
  city: string;
  description: string;
  created_at: string;
};
export type OrganizationMembership = {
  id: string;
  organizationId: string;
  personId: string;
  role: "admin" | "member";
  joined_at: string;
};
export type OrganizationMember = OrganizationMembership & {
  name: string;
  email: string | null;
};
export type OrganizationSnapshot = {
  organizations: Organization[];
  memberships: OrganizationMembership[];
};
export type OrganizationInput = Pick<
  Organization,
  "name" | "website" | "city" | "description"
>;
export type OrganizationInvitation = {
  token: string;
  organizationId: string;
  email: string;
  role: "admin" | "member";
  expires_at: string;
};
