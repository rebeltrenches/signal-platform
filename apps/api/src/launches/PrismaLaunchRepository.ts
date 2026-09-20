import type {
  LaunchRepository,
  LaunchRecord,
  LaunchStatus,
  CreateDraftLaunchInput,
  SetBondingCurveConfigInput,
} from './LaunchRepository.js';
import { LaunchValidationError, LaunchNotFoundError } from './LaunchRepository.js';

function isValidBps(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= 10000;
}

export interface LaunchPrismaLikeClient {
  launch: {
    findUnique(args: any): Promise<any>;
    findMany(args: any): Promise<any[]>;
    create(args: any): Promise<any>;
    update(args: any): Promise<any>;
  };
  bondingCurve: { update(args: any): Promise<any> };
}

function mapLaunch(row: any): LaunchRecord {
  return {
    id: row.id, tokenId: row.tokenId, status: row.status,
    creatorAllocationBps: row.creatorAllocationBps, launchAllocationBps: row.launchAllocationBps,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
    bondingCurve: row.bondingCurve ? {
      id: row.bondingCurve.id, launchId: row.bondingCurve.launchId, curveType: row.bondingCurve.curveType,
      graduationThreshold: String(row.bondingCurve.graduationThreshold),
      currentProgress: String(row.bondingCurve.currentProgress), parameters: row.bondingCurve.parameters,
    } : null,
    graduation: row.graduation ? {
      id: row.graduation.id, launchId: row.graduation.launchId, dexId: row.graduation.dexId,
      poolAddress: row.graduation.poolAddress,
      graduatedAt: row.graduation.graduatedAt instanceof Date ? row.graduation.graduatedAt.toISOString() : row.graduation.graduatedAt,
    } : null,
  };
}
const INCLUDE_RELATIONS = { bondingCurve: true, graduation: true };

export class PrismaLaunchRepository implements LaunchRepository {
  constructor(private readonly db: LaunchPrismaLikeClient) {}
  async createDraftLaunch(input: CreateDraftLaunchInput): Promise<LaunchRecord> {
    if (!input.tokenId) throw new LaunchValidationError('tokenId is required.');
    if (!isValidBps(input.creatorAllocationBps)) throw new LaunchValidationError('creatorAllocationBps must be an integer between 0 and 10000.');
    if (!isValidBps(input.launchAllocationBps)) throw new LaunchValidationError('launchAllocationBps must be an integer between 0 and 10000.');
    const existing = await this.db.launch.findUnique({ where: { tokenId: input.tokenId }, include: INCLUDE_RELATIONS });
    if (existing) return mapLaunch(existing);
    const created = await this.db.launch.create({ data: { tokenId: input.tokenId, status: 'DRAFT', creatorAllocationBps: input.creatorAllocationBps, launchAllocationBps: input.launchAllocationBps } });
    return mapLaunch({ ...created, bondingCurve: null, graduation: null });
  }
  async getLaunchByTokenId(tokenId: string) {
    const row = await this.db.launch.findUnique({ where: { tokenId }, include: INCLUDE_RELATIONS }); return row ? mapLaunch(row) : null;
  }
  async getLaunchById(launchId: string) {
    const row = await this.db.launch.findUnique({ where: { id: launchId }, include: INCLUDE_RELATIONS }); return row ? mapLaunch(row) : null;
  }
  async listLaunches(status?: LaunchStatus) {
    const rows = await this.db.launch.findMany({ where: status ? { status } : {}, include: INCLUDE_RELATIONS, orderBy: { createdAt: 'desc' } }); return rows.map(mapLaunch);
  }
  async setBondingCurveConfig(launchId: string, input: SetBondingCurveConfigInput): Promise<LaunchRecord> {
    const launch = await this.db.launch.findUnique({ where: { id: launchId }, include: INCLUDE_RELATIONS });
    if (!launch) throw new LaunchNotFoundError(`No launch found with id ${launchId}.`);
    if (launch.status !== 'DRAFT') throw new LaunchValidationError(`Cannot set bonding curve config on a launch that is not DRAFT (current status: ${launch.status}).`);
    if (!input.curveType) throw new LaunchValidationError('curveType must be a non-empty string.');
    if (!/^\d+$/.test(input.graduationThreshold)) throw new LaunchValidationError('graduationThreshold must be a non-negative integer string (base units, never a float).');
    if (!input.parameters || typeof input.parameters !== 'object' || Array.isArray(input.parameters)) throw new LaunchValidationError('parameters must be a JSON object.');
    const updated = await this.db.launch.update({ where: { id: launchId }, data: { status: 'BONDING', bondingCurve: { create: { curveType: input.curveType, graduationThreshold: input.graduationThreshold, currentProgress: '0', parameters: input.parameters } } }, include: INCLUDE_RELATIONS });
    return mapLaunch(updated);
  }
  async updateBondingCurveProgress(launchId: string, newProgress: string): Promise<LaunchRecord> {
    const launch = await this.db.launch.findUnique({ where: { id: launchId }, include: INCLUDE_RELATIONS });
    if (!launch) throw new LaunchNotFoundError(`No launch found with id ${launchId}.`);
    if (launch.status !== 'BONDING' || !launch.bondingCurve) throw new LaunchValidationError('Progress can only be updated for a BONDING launch with a configured bonding curve.');
    if (!/^\d+$/.test(newProgress)) throw new LaunchValidationError('newProgress must be a non-negative integer string.');
    await this.db.bondingCurve.update({ where: { launchId }, data: { currentProgress: newProgress } });
    const updated = await this.db.launch.findUnique({ where: { id: launchId }, include: INCLUDE_RELATIONS }); return mapLaunch(updated);
  }
  async markGraduated(launchId: string, dexId: string, poolAddress: string | null): Promise<LaunchRecord> {
    if (!dexId) throw new LaunchValidationError('dexId is required.');
    const launch = await this.db.launch.findUnique({ where: { id: launchId } });
    if (!launch) throw new LaunchNotFoundError(`No launch found with id ${launchId}.`);
    if (launch.status !== 'BONDING') throw new LaunchValidationError('Only a BONDING launch can graduate.');
    const updated = await this.db.launch.update({ where: { id: launchId }, data: { status: 'GRADUATED', graduation: { create: { dexId, poolAddress, graduatedAt: new Date() } } }, include: INCLUDE_RELATIONS });
    return mapLaunch(updated);
  }
}
