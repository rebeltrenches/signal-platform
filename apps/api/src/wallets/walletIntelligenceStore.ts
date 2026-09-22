import { traceFundingAncestry } from './FundingAncestry.js';
import { buildSignalTrace } from './SignalTrace.js';
import { buildWalletHistoryReplay } from './WalletHistoryReplay.js';
import { buildWalletRelationshipClusters } from './WalletRelationshipClusters.js';
import { buildWalletProjectHistory } from './WalletProjectHistory.js';
import type { WalletIntelligenceRepository } from './WalletIntelligenceRepository.js';
import { PrismaWalletIntelligenceRepository, type WalletIntelligencePrismaLikeClient } from './PrismaWalletIntelligenceRepository.js';
import { getSharedPrismaClient } from '../db/prismaClient.js';

let repository: WalletIntelligenceRepository | null = null;

export async function initializeWalletIntelligenceStorage(): Promise<void> {
  if (process.env.CHAT_STORAGE !== 'database') return;
  const db = (await getSharedPrismaClient()) as WalletIntelligencePrismaLikeClient;
  repository = new PrismaWalletIntelligenceRepository(db);
}

export async function getWalletIntelligence(chain: string, address: string) {
  // Wallet Intelligence is intentionally database-backed only. Returning
  // a fake in-memory wallet would undermine the evidence guarantees.
  if (!repository) {
    if (process.env.CHAT_STORAGE !== 'database') return null;
    throw new Error('Database wallet intelligence storage requested but initializeWalletIntelligenceStorage() has not completed.');
  }
  return repository.getWallet(chain, address);
}

export async function getFundingAncestry(chain: string, address: string, maxDepth = 3) {
  if (!repository) {
    if (process.env.CHAT_STORAGE !== 'database') return null;
    throw new Error('Database wallet intelligence storage requested but initializeWalletIntelligenceStorage() has not completed.');
  }
  const reader = repository as WalletIntelligenceRepository & { incomingFunding?: (chain: string, address: string) => Promise<any[]> };
  if (!reader.incomingFunding) throw new Error('Funding ancestry reader is not available.');
  return traceFundingAncestry({ incomingFunding: reader.incomingFunding.bind(reader) }, chain, address, maxDepth);
}

export async function getSignalTrace(chain: string, address: string, maxDepth = 3) {
  const ancestry = await getFundingAncestry(chain, address, maxDepth);
  if (!ancestry) return null;
  return buildSignalTrace(chain, ancestry);
}

export async function getWalletHistoryReplay(chain: string, address: string, maxDepth = 3) {
  const trace = await getSignalTrace(chain, address, maxDepth);
  if (!trace) return null;
  return buildWalletHistoryReplay(trace);
}

export async function getWalletRelationshipClusters(chain: string, address: string, maxDepth = 3) {
  const trace = await getSignalTrace(chain, address, maxDepth);
  if (!trace) return null;
  return buildWalletRelationshipClusters(trace);
}

export async function getWalletProjectHistory(chain: string, address: string, maxDepth = 3) {
  const trace = await getSignalTrace(chain, address, maxDepth);
  if (!trace) return null;
  const reader = repository as WalletIntelligenceRepository & {
    indexedProjectsCreatedByWallets?: (chain: string, addresses: string[]) => Promise<any[]>;
  };
  if (!reader.indexedProjectsCreatedByWallets) throw new Error('Wallet project history reader is not available.');
  const projects = await reader.indexedProjectsCreatedByWallets(chain, trace.nodes.map((node) => node.address));
  return buildWalletProjectHistory(trace, projects);
}
