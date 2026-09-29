import {
  createPaperService,
  createPaperSettlementService,
  type PaperRepository,
  type PaperSettlementRepository,
  type PaperMarketData,
  type PaperResolutionProvider,
} from "@pickler/trading/polymarket";
export function createPaperPlugin(
  repository: PaperRepository & PaperSettlementRepository,
  data: PaperMarketData,
  resolution: PaperResolutionProvider,
) {
  return {
    ...createPaperService(repository, data),
    ...createPaperSettlementService(repository, resolution),
  };
}
