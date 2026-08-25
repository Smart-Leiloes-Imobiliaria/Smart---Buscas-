export const userRoles = ["ADMIN", "USER"] as const;

export type UserRole = (typeof userRoles)[number];

export type AuthenticatedUser = {
  id: string;
  email: string;
  role: UserRole;
};
