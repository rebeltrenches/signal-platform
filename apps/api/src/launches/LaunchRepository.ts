export type LaunchStatus = 'DRAFT' | 'BONDING' | 'GRADUATED' | 'FAILED';

export interface LaunchRecord {
  id: string;
  tokenId: string;
  status: LaunchStatus;
  creatorAllocationBps: number;
  launchAllocationBps: number;
  createdAt: string;
  bondingCurve: BondingCurveRecord | null;
  graduation: GraduationRecord | null;
}

export interface BondingCurveRecord {
  id: string;
  launchId: string;
  curveType: string;
  graduationThreshold: string;
  currentProgress: string;
  parameters: Record<string, unknown>;
}

export interface GraduationRecord {
  id: string;
  launchId: string;
  dexId: string;
  poolAddress: string | null;
  graduatedAt: string | null;
}

export interface CreateDraftLaunchInput {
  tokenId: string;
  creatorAllocationBps: number;
  launchAllocationBps: number;
}

export interface SetBondingCurveConfigInput {
  curveType: string;
  graduationThreshold: string;
  parameters: Record<string, unknown>;
}

export class LaunchValidationError extends Error {}
export class LaunchNotFoundError extends Error {}

export interface LaunchRepository {
  createDraftLaunch(input: CreateDraftLaunchInput): Promise<LaunchRecord>;
  getLaunchByTokenId(tokenId: string): Promise<LaunchRecord | null>;
  getLaunchById(launchId: string): Promise<LaunchRecord | null>;
  listLaunches(status?: LaunchStatus): Promise<LaunchRecord[]>;
  setBondingCurveConfig(launchId: string, input: SetBondingCurveConfigInput): Promise<LaunchRecord>;
  updateBondingCurveProgress(launchId: string, newProgress: string): Promise<LaunchRecord>;
  markGraduated(launchId: string, dexId: string, poolAddress: string | null): Promise<LaunchRecord>;
}
