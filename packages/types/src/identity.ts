import type { PermissionKey } from './permissions';
import { apiStatuses } from './api';

export const userStatuses = ['pending', 'active', 'disabled'] as const;
export type UserStatus = (typeof userStatuses)[number];

export const workspaceStatuses = ['active', 'disabled'] as const;
export type WorkspaceStatus = (typeof workspaceStatuses)[number];

export const memberStatuses = ['pending', 'active', 'suspended', 'removed'] as const;
export type MemberStatus = (typeof memberStatuses)[number];

export const permissionEffects = ['allow', 'deny'] as const;
export type PermissionEffect = (typeof permissionEffects)[number];

export interface UserProfile {
  id: string;
  email: string;
  username: string;
  name: string;
  nickname: string;
  avatarUrl: string | null;
  phone: string | null;
  emailVerifiedAt: string | null;
  phoneVerifiedAt: string | null;
  status: UserStatus;
  createdAt: string;
  updatedAt: string;
}

export interface AuthenticatedActor {
  userId: string;
  workspaceId: number;
  sessionId: string;
  permissions: PermissionKey[];
  isSystemAdmin: boolean;
  isWorkspaceAdmin: boolean;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresIn: number;
}

export const mfaFactors = ['email', 'sms', 'totp', 'passkey'] as const;
export type MfaFactor = (typeof mfaFactors)[number];

export type LoginOptions =
  | { next: 'login' }
  | { next: 'register'; email: string };

export interface AuthCompleted {
  outcome: 'authenticated';
  tokens: AuthTokens;
}

export interface MfaRequired {
  outcome: 'mfa_required';
  challengeId: string;
  factors: MfaFactor[];
  expiresIn: number;
}

export type AuthenticationResult = AuthCompleted | MfaRequired;

export interface RegistrationStarted {
  registrationId: string;
  expiresIn: number;
}

export interface RegistrationVerified {
  verified: true;
}

export const authErrorCodes = [
  apiStatuses.accountNotFound,
  apiStatuses.invalidCredentials,
  apiStatuses.registrationExpired,
  apiStatuses.registrationUnverified,
  apiStatuses.usernameUnavailable,
] as const;
export type AuthErrorCode = (typeof authErrorCodes)[number];

export interface WorkspaceSummary {
  id: number;
  name: string;
  slug: string;
  ownerUserId: string;
  status: WorkspaceStatus;
}

export interface WorkspaceMemberSummary {
  id: string;
  workspaceId: number;
  userId: string;
  memberTypeId: string;
  status: MemberStatus;
  isWorkspaceAdmin: boolean;
  joinedAt: string | null;
}

export interface WorkspaceMemberTypeSummary {
  id: string;
  workspaceId: number;
  name: string;
  slug: string;
  isSystem: boolean;
}

export interface RoleSummary {
  id: string;
  workspaceId: number;
  code: string;
  name: string;
  description: string | null;
  permissionKeys: PermissionKey[];
}

export interface DirectPermissionGrant {
  permissionKey: PermissionKey;
  effect: PermissionEffect;
}

export interface EffectivePermissions {
  permissions: PermissionKey[];
}
