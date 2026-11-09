export async function collectRefinementCampaigns(campaigns, baseObligations = []) {
  const receipts = [], obligations = [...baseObligations], failures = [];
  const record = result => {
    const checked = result?.receipts ?? (Array.isArray(result) ? result : [result?.receipt ?? result]);
    const remaining = result?.obligations ?? [];
    if (!Array.isArray(checked) || checked.some(receipt => typeof receipt?.passed !== 'boolean')
      || !Array.isArray(remaining)) throw Error('Invalid refinement adapter result');
    receipts.push(...checked);
    obligations.push(...remaining);
  };
  for (const [campaign, check] of campaigns) {
    const start = receipts.length;
    try {
      const result = await check(record);
      if (result !== undefined || receipts.length === start) record(result);
      const failed = receipts.slice(start).filter(receipt => !receipt.passed);
      if (failed.length) throw Error('Failed refinement receipts: ' + failed.map(receipt => receipt.model).join(', '));
    } catch (error) {
      failures.push({campaign, error});
    }
  }
  return {receipts, obligations, failures};
}
