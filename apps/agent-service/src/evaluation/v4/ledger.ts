import { CampaignLedger } from "../v2/ledger";
import { EvaluationFailure } from "../decision-evaluation";
export class RevisionLedger extends CampaignLedger {
  constructor(
    directory: string,
    historicalUsd: number,
    readonly previous: CampaignLedger[],
  ) {
    super(directory, historicalUsd);
  }
  override async reserve(caseId: string, variant: string, reservedUsd: number, metadata: unknown) {
    const accounts = await Promise.all(
      [...this.previous, this].map((ledger) => ledger.accounting()),
    );
    const calls = accounts.reduce((sum, item) => sum + item.calls, 0);
    const amount = accounts.reduce((sum, item) => sum + item.accountedUsd, 0);
    if (
      calls >= 176 ||
      amount + reservedUsd > 0.5 ||
      this.previousAccountedUsd + amount + reservedUsd > 1
    ) {
      throw new EvaluationFailure("V4_SHARED_CAMPAIGN_LIMIT");
    }
    return super.reserve(caseId, variant, reservedUsd, metadata);
  }
}
