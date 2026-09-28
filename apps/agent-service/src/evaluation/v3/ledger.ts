import { CampaignLedger } from "../v2/ledger";
import { EvaluationFailure } from "../decision-evaluation";

export class RevisionLedger extends CampaignLedger {
  constructor(
    directory: string,
    previousAccountedUsd: number,
    readonly previous: CampaignLedger,
  ) {
    super(directory, previousAccountedUsd);
  }
  override async reserve(caseId: string, variant: string, reservedUsd: number, metadata: unknown) {
    const before = await this.previous.accounting();
    const current = await this.accounting();
    if (
      before.calls + current.calls >= 176 ||
      before.accountedUsd + current.accountedUsd + reservedUsd > 0.5
    ) {
      throw new EvaluationFailure("V3_SHARED_CAMPAIGN_LIMIT");
    }
    return super.reserve(caseId, variant, reservedUsd, metadata);
  }
}
