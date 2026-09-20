import crypto from 'node:crypto';
import type { LaunchRepository, LaunchRecord, LaunchStatus, CreateDraftLaunchInput, SetBondingCurveConfigInput } from './LaunchRepository.js';
import { LaunchValidationError, LaunchNotFoundError } from './LaunchRepository.js';

function isValidBps(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= 10000;
}

export class MemoryLaunchRepository implements LaunchRepository {
  private launches = new Map<string, LaunchRecord>();
  private byTokenId = new Map<string, string>();

  async createDraftLaunch(input: CreateDraftLaunchInput): Promise<LaunchRecord> {
    if (!input.tokenId) throw new LaunchValidationError('tokenId is required.');
    if (!isValidBps(input.creatorAllocationBps)) throw new LaunchValidationError('creatorAllocationBps must be an integer between 0 and 10000.');
    if (!isValidBps(input.launchAllocationBps)) throw new LaunchValidationError('launchAllocationBps must be an integer between 0 and 10000.');
    const existingId = this.byTokenId.get(input.tokenId);
    if (existingId) return this.launches.get(existingId)!;
    const record: LaunchRecord = {
      id: crypto.randomUUID(), tokenId: input.tokenId, status: 'DRAFT',
      creatorAllocationBps: input.creatorAllocationBps, launchAllocationBps: input.launchAllocationBps,
      createdAt: new Date().toISOString(), bondingCurve: null, graduation: null,
    };
    this.launches.set(record.id, record);
    this.byTokenId.set(record.tokenId, record.id);
    return record;
  }

  async getLaunchByTokenId(tokenId: string) { const id = this.byTokenId.get(tokenId); return id ? this.launches.get(id) ?? null : null; }
  async getLaunchById(launchId: string) { return this.launches.get(launchId) ?? null; }
  async listLaunches(status?: LaunchStatus) {
    const all = Array.from(this.launches.values());
    return status ? all.filter((l) => l.status === status) : all;
  }

  async setBondingCurveConfig(launchId: string, input: SetBondingCurveConfigInput): Promise<LaunchRecord> {
    const launch = this.launches.get(launchId);
    if (!launch) throw new LaunchNotFoundError(`No launch found with id ${launchId}.`);
    if (launch.status !== 'DRAFT') throw new LaunchValidationError(`Cannot set bonding curve config on a launch that is not DRAFT (current status: ${launch.status}).`);
    if (!input.curveType) throw new LaunchValidationError('curveType must be a non-empty string.');
    if (!/^\d+$/.test(input.graduationThreshold)) throw new LaunchValidationError('graduationThreshold must be a non-negative integer string (base units, never a float).');
    if (!input.parameters || typeof input.parameters !== 'object' || Array.isArray(input.parameters)) throw new LaunchValidationError('parameters must be a JSON object.');
    launch.bondingCurve = { id: crypto.randomUUID(), launchId, curveType: input.curveType, graduationThreshold: input.graduationThreshold, currentProgress: '0', parameters: input.parameters };
    launch.status = 'BONDING';
    return launch;
  }

  async updateBondingCurveProgress(launchId: string, newProgress: string): Promise<LaunchRecord> {
    const launch = this.launches.get(launchId);
    if (!launch) throw new LaunchNotFoundError(`No launch found with id ${launchId}.`);
    if (!launch.bondingCurve) throw new LaunchValidationError('Cannot update progress on a launch with no bonding curve configured.');
    if (!/^\d+$/.test(newProgress)) throw new LaunchValidationError('newProgress must be a non-negative integer string.');
    launch.bondingCurve.currentProgress = newProgress;
    return launch;
  }

  async markGraduated(launchId: string, dexId: string, poolAddress: string | null): Promise<LaunchRecord> {
    const launch = this.launches.get(launchId);
    if (!launch) throw new LaunchNotFoundError(`No launch found with id ${launchId}.`);
    if (launch.status !== 'BONDING') throw new LaunchValidationError('Only a BONDING launch can graduate.');
    if (!dexId) throw new LaunchValidationError('dexId is required.');
    launch.graduation = { id: crypto.randomUUID(), launchId, dexId, poolAddress, graduatedAt: new Date().toISOString() };
    launch.status = 'GRADUATED';
    return launch;
  }

  __resetForTests() { this.launches.clear(); this.byTokenId.clear(); }
}
